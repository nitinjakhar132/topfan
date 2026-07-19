"use client";

interface PlayersEmptyStateProps {
  type: "no-results" | "no-team" | "no-trusted" | "error";
  onRetry?: () => void;
}

export function PlayersEmptyState({ type, onRetry }: PlayersEmptyStateProps) {
  if (type === "no-results") {
    return (
      <div className="players-empty" role="status">
        <h4>No players found</h4>
        <p>Try another name, team, or position.</p>
      </div>
    );
  }
  if (type === "no-team") {
    return (
      <div className="players-empty" role="status">
        <h4>No players available for this team yet</h4>
        <p>Player data will appear once matches are finalised.</p>
      </div>
    );
  }
  if (type === "no-trusted") {
    return (
      <div className="players-empty" role="status">
        <h4>You have not selected any players yet</h4>
        <p>Your trusted players will appear after your first completed match.</p>
      </div>
    );
  }
  // error
  return (
    <div className="players-empty" role="alert">
      <h4>We couldn't load the players</h4>
      <p>Something went wrong fetching player data.</p>
      {onRetry && <button onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function PlayersSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div className="players-skeleton-card" key={i} aria-hidden="true">
          <div className="players-skel-avatar" />
          <div className="players-skel-body">
            <div className="players-skel-line medium" />
            <div className="players-skel-line short" />
            <div className="players-skel-line tiny" />
          </div>
          <div className="players-skel-rating" />
        </div>
      ))}
    </>
  );
}
