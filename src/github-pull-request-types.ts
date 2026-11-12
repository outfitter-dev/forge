/**
 * What Forge reads from GitHub about one pull request. These are observations
 * of a mutable service: parsing establishes their shape, not who produced them
 * or that they still hold.
 */
/** Every deleted account is returned under this login. */
export const GITHUB_GHOST_LOGIN = "ghost";

/**
 * An account as GitHub names it now. Deleted accounts all come back as the
 * same placeholder, so that one identity can stand for several people. A login
 * can also change; `id` is the stable key for an account that still exists.
 */
export interface GitHubActor {
  id: number;
  login: string;
  /** GitHub's own account kind, such as `User` or `Bot`. */
  type: string;
}

export interface GitHubTeam {
  id: number;
  slug: string;
}

export interface GitHubPullRequest {
  number: number;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  /**
   * `null` while GitHub has not computed it: unknown, never mergeable. `true`
   * is GitHub's merge computation only, not a statement that rules allow landing.
   */
  mergeable: boolean | null;
  author: GitHubActor;
  /** A head whose fork was deleted has no repository. */
  head: { sha: string; ref: string; repositoryId: number | null };
  /** `repositoryName` is `owner/name` as GitHub reports it now, after any rename. */
  base: {
    sha: string;
    ref: string;
    repositoryId: number;
    repositoryName: string;
  };
  labels: { id: number; name: string }[];
  requestedReviewers: GitHubActor[];
  requestedTeams: GitHubTeam[];
}

/** One `review_requested` timeline event. Later removal does not erase it. */
export type GitHubReviewRequest =
  | { kind: "user"; reviewer: GitHubActor }
  | { kind: "team"; team: GitHubTeam };

/** A timeline event after which the pull request's base is not what it was. */
export interface GitHubBaseChange {
  event: "base_ref_changed" | "base_ref_force_pushed";
  createdAt: string;
}

export const GITHUB_REVIEW_STATES = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "DISMISSED",
  "COMMENTED",
  "PENDING",
] as const;

export type GitHubReviewState = (typeof GITHUB_REVIEW_STATES)[number];

export interface GitHubReview {
  id: number;
  author: GitHubActor;
  state: GitHubReviewState;
  /** The commit reviewed. GitHub records no base for a review. */
  commitId: string | null;
  /** A whole-second UTC time. `null` only for a pending review. */
  submittedAt: string | null;
}

export interface GitHubReviewThreadPage {
  /** Threads on this page not explicitly resolved. */
  unresolved: number;
  nextCursor: string | null;
}
