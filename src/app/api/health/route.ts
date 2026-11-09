export async function GET() {
  return Response.json({ status: 'ok', at: new Date().toISOString() });
}
