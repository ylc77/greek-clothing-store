export function GET() {
  return new Response("This product feed has been removed.", {
    status: 410,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
