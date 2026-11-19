#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#ifndef FORGE_BOOTSTRAP_DIRECTORY
#define FORGE_BOOTSTRAP_DIRECTORY "/etc/forge/trusted-bootstrap"
#endif
#ifndef FORGE_DISPATCHER
#define FORGE_DISPATCHER "/opt/forge/bootstrap/forge-buildkite-dispatch"
#endif
#define CONFIG FORGE_BOOTSTRAP_DIRECTORY "/dispatch.json"

static int refuse(const char *message) {
  dprintf(STDERR_FILENO, "Forge bootstrap hook: %s\n", message);
  return 1;
}

static int valid_value(const char *value) {
  if (value == NULL || *value == '\0' || strlen(value) > 8192) {
    return 0;
  }
  for (; *value; value++) {
    if ((unsigned char)*value <= 32 || (unsigned char)*value >= 127) {
      return 0;
    }
  }
  return 1;
}

static int write_mapping(const char *path, const char *value) {
  int fd = open(path, O_WRONLY | O_CLOEXEC);
  if (fd == -1) {
    return -1;
  }
  size_t length = strlen(value);
  ssize_t n = write(fd, value, length);
  int closed = close(fd);
  return n == (ssize_t)length && closed == 0 ? 0 : -1;
}

static int prepare_namespace(uid_t uid, gid_t gid) {
  char users[64], groups[64];
  snprintf(users, sizeof(users), "%u %u 1\n", uid, uid);
  snprintf(groups, sizeof(groups), "%u %u 1\n", gid, gid);
  return unshare(CLONE_NEWUSER | CLONE_NEWPID) == 0 &&
         write_mapping("/proc/self/setgroups", "deny\n") == 0 &&
         write_mapping("/proc/self/uid_map", users) == 0 &&
         write_mapping("/proc/self/gid_map", groups) == 0;
}

static void accept_signal(int sig) { (void)sig; }

static int watch(pid_t child, const sigset_t *signals) {
  int interrupted = 0;
  for (;;) {
    int status;
    pid_t result = waitpid(child, &status, WNOHANG);
    if (result == child) {
      alarm(0);
      if (interrupted) {
        return 128 + interrupted;
      }
      return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
    }
    if (result == -1 && errno != EINTR) {
      return refuse("could not wait for the dispatcher.");
    }
    int sig = sigwaitinfo(signals, NULL);
    if (sig == SIGINT || sig == SIGTERM) {
      if (!interrupted) {
        interrupted = sig;
        kill(child, sig);
        alarm(2);
      }
    } else if (sig == SIGALRM || (sig == -1 && errno != EINTR)) {
      kill(child, SIGKILL);
      while (waitpid(child, NULL, 0) == -1 && errno == EINTR) {
      }
      return interrupted ? 128 + interrupted : 1;
    }
  }
}

static int supervise(int pipe_read, const sigset_t *signals, char **env) {
  char byte;
  // The pipe covers a parent death before PR_SET_PDEATHSIG was armed.
  if (prctl(PR_SET_PDEATHSIG, SIGKILL, 0, 0, 0) == -1 ||
      read(pipe_read, &byte, 1) != -1 || errno != EAGAIN) {
    return refuse("the launcher is no longer supervising.");
  }
  close(pipe_read);
  pid_t child = fork();
  if (child == -1) {
    return refuse("could not start the dispatcher.");
  }
  if (child == 0) {
    sigset_t empty;
    sigemptyset(&empty);
    if (sigprocmask(SIG_SETMASK, &empty, NULL) == -1) {
      return refuse("could not restore the dispatcher signal mask.");
    }
    char *const argv[] = {FORGE_DISPATCHER, CONFIG, NULL};
    execve(FORGE_DISPATCHER, argv, env);
    return refuse("could not start the dispatcher.");
  }
  // Exiting as PID 1 kills the namespace, including detached descendants.
  return watch(child, signals);
}

int main(int argc, char **argv) {
  (void)argv;
  const char *step = getenv("BUILDKITE_STEP_KEY");
  if (argc != 1 || step == NULL || strcmp(step, "forge-bootstrap") != 0) {
    return refuse("only the trusted forge-bootstrap step is enabled.");
  }
  uid_t uid = getuid();
  gid_t gid = getgid();
  if (uid == 0 || uid != geteuid() || gid != getegid()) {
    return refuse("a dedicated unprivileged agent account is required.");
  }
  const char *const allowed[] = {"BUILDKITE_JOB_ID", "BUILDKITE_AGENT_ACCESS_TOKEN",
                                 "FORGE_BUILDKITE_READ_TOKEN", "FORGE_GITHUB_TOKEN"};
  char *env[] = {"HOME=" FORGE_BOOTSTRAP_DIRECTORY,
                 "PATH=/usr/bin:/bin", NULL, NULL, NULL, NULL, NULL};
  for (size_t i = 0; i < sizeof(allowed) / sizeof(allowed[0]); i++) {
    const char *value = getenv(allowed[i]);
    if (!valid_value(value) || asprintf(&env[i + 2], "%s=%s", allowed[i], value) == -1) {
      return refuse("protected job inputs are missing or invalid.");
    }
  }

  umask(077);
  if (chdir(FORGE_BOOTSTRAP_DIRECTORY) == -1 ||
      close_range(3, ~0U, 0) == -1 ||
      prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == -1) {
    return refuse("could not prepare the protected execution context.");
  }
  int input = open("/dev/null", O_RDONLY);
  if (input == -1 || dup2(input, STDIN_FILENO) == -1) {
    return refuse("could not disconnect job input.");
  }
  if (input != STDIN_FILENO) {
    close(input);
  }

  sigset_t signals;
  sigemptyset(&signals);
  sigaddset(&signals, SIGCHLD);
  sigaddset(&signals, SIGINT);
  sigaddset(&signals, SIGTERM);
  sigaddset(&signals, SIGALRM);
  struct sigaction action = {.sa_handler = accept_signal};
  sigemptyset(&action.sa_mask);
  if (sigprocmask(SIG_BLOCK, &signals, NULL) == -1 ||
      sigaction(SIGCHLD, &action, NULL) == -1 ||
      sigaction(SIGINT, &action, NULL) == -1 ||
      sigaction(SIGTERM, &action, NULL) == -1 ||
      sigaction(SIGALRM, &action, NULL) == -1) {
    return refuse("could not prepare signal supervision.");
  }

  int parent[2];
  if (pipe2(parent, O_CLOEXEC | O_NONBLOCK) == -1 || !prepare_namespace(uid, gid)) {
    return refuse("could not establish Linux job containment.");
  }
  pid_t init = fork();
  if (init == -1) {
    return refuse("could not start Linux job containment.");
  }
  if (init == 0) {
    close(parent[1]);
    _exit(supervise(parent[0], &signals, env));
  }
  close(parent[0]);
  return watch(init, &signals);
}
