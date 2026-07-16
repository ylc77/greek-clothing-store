/**
 * Serializes structured data for an inline application/ld+json script.
 *
 * JSON.stringify alone is not safe in an HTML parser because a string value
 * containing </script> ends the element before the JavaScript/JSON parser sees
 * it. Escaping every HTML-significant character keeps user-controlled values
 * inside the JSON string while preserving the value returned by JSON.parse.
 */
export function serializeJsonForHtmlScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
