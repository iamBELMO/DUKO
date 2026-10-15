import { env } from 'cloudflare:workers';
import { handleApi } from '../../../lib/hosted.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleApi(request, env.DB!); }
export function POST(request: Request) { return handleApi(request, env.DB!); }
