interface ClanTagProps {
  tag: string | null | undefined;
  className?: string;
}

export function ClanTag({ tag, className = "" }: ClanTagProps) {
  if (!tag) return null;
  return <span className={`text-muted-foreground font-medium ${className}`}>[{tag}]</span>;
}

export function UsernameWithClan({
  username,
  clanTag,
  className = "",
  tagClassName = "",
}: {
  username: string;
  clanTag?: string | null;
  className?: string;
  tagClassName?: string;
}) {
  return (
    <span className={className}>
      {clanTag && <span className={`text-muted-foreground font-medium ${tagClassName}`}>[{clanTag}]&nbsp;</span>}
      {username}
    </span>
  );
}
