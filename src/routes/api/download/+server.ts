import type { RequestHandler } from '@sveltejs/kit';
import {
	createDownloadHeaders,
	createDownloadStream,
	parseDownloadRange,
	parseDownloadSize
} from '$lib/server/download';

export const HEAD: RequestHandler = ({ url }) => {
	const size = parseDownloadSize(url.searchParams.get('size'));

	return new Response(null, {
		status: 200,
		headers: createDownloadHeaders(size)
	});
};

export const GET: RequestHandler = ({ request, url }) => {
	const size = parseDownloadSize(url.searchParams.get('size'));
	const delayValue = Number(url.searchParams.get('delay'));
	const chunkDelayMs = Number.isFinite(delayValue) && delayValue > 0 ? Math.floor(delayValue) : 0;
	const range = parseDownloadRange(request.headers.get('range'), size);

	if (!range) {
		return new Response(null, {
			status: 416,
			headers: new Headers({
				'content-range': `bytes */${size}`,
				'cache-control': 'no-store',
				'accept-ranges': 'bytes'
			})
		});
	}

	const body = createDownloadStream(size, range.start, range.end, chunkDelayMs);
	const contentLength = range.end - range.start + 1;
	const headers = createDownloadHeaders(contentLength);
	headers.set('content-length', String(contentLength));

	if (range.partial) {
		headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
	}

	return new Response(body, {
		status: range.partial ? 206 : 200,
		headers
	});
};