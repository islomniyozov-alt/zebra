// NO ROW, NO PORTAL (§9, the landing rule). A sign-in with no roster row
// linked sees one sentence on every portal screen and nothing else — not an
// empty list, which would read as "you have no loads".

export function NoDriverRow({ sentence }: { sentence: string }) {
  return (
    <section className="px-z4 py-z8 text-center">
      <p className="text-base text-ink-2">{sentence}</p>
    </section>
  )
}
