export function Pips({ stars }: { stars: number | null }) {
  const label = stars == null ? "Not ranked" : `${stars} of 5`
  return (
    <span className="pips" role="img" aria-label={label} title={label}>
      {[0, 1, 2, 3, 4].map((index) => (
        <i key={index} className={stars != null && index < stars ? "on" : ""} />
      ))}
    </span>
  )
}
