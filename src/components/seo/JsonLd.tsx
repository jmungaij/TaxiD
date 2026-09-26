/**
 * Structured data (schema.org JSON-LD) emitter.
 *
 * Search engines need the payload inside a `application/ld+json` script tag.
 * Rendering it as a text child lets React set the script's text content
 * directly, so no page ever has to hand raw HTML to the DOM
 * (`dangerouslySetInnerHTML`) just to publish structured data.
 *
 * `<` is escaped so a string value inside the payload can never terminate the
 * script element early — the classic JSON-LD injection vector.
 */
export interface JsonLdProps {
  /** Any serialisable schema.org object or array of objects. */
  data: unknown;
}

export function JsonLd({ data }: JsonLdProps) {
  const serialised = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script type="application/ld+json" suppressHydrationWarning>
      {serialised}
    </script>
  );
}

export default JsonLd;
