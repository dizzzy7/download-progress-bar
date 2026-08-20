import type { RequestHandler } from '@sveltejs/kit';

const defaultSize = 25 * 1024 * 1024;
const chunkSize = 64 * 1024;

function parseSize(value: string | null) {
	if (!value) {
		return defaultSize;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return defaultSize;
	}

	return Math.floor(parsed);
}

function createStream(size: number) {
	return createStreamRange(size, 0);
}

function parseRange(rangeHeader: string | null, size: number) {
	if (!rangeHeader) {
		return { start: 0, end: size - 1, partial: false };
	}

	const match = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader);
	if (!match) {
		return null;
	}

	const start = Number(match[1]);
	const requestedEnd = match[2] ? Number(match[2]) : size - 1;

	if (!Number.isFinite(start) || start < 0 || start >= size) {
		return null;
	}

	if (!Number.isFinite(requestedEnd) || requestedEnd < start) {
		return null;
	}

	const end = Math.min(requestedEnd, size - 1);

	return {
		start,
		end,
		partial: start > 0 || end < size - 1
	};
}

function createStreamRange(size: number, start: number, end = size - 1) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			let sent = start;
			const chunk = new Uint8Array(Math.min(chunkSize, size));

			const push = () => {
				while (sent <= end) {
					const nextSize = Math.min(chunkSize, end - sent + 1);
					controller.enqueue(nextSize === chunk.length ? chunk : chunk.slice(0, nextSize));
					sent += nextSize;
					if (sent <= end) {
						queueMicrotask(push);
						return;
					}
				}

				controller.close();
			};

			push();
		}
	});
}

function createHeaders(size: number) {
	return new Headers({
		'cache-control': 'no-store',
		'content-length': String(size),
		'content-type': 'application/octet-stream',
		'accept-ranges': 'bytes',
		'content-disposition': 'attachment; filename="demo-download.bin"'
	});
}

export const HEAD: RequestHandler = ({ url }) => {
	const size = parseSize(url.searchParams.get('size'));

	return new Response(null, {
		status: 200,
		headers: createHeaders(size)
	});
};

export const GET: RequestHandler = ({ request, url }) => {
	const size = parseSize(url.searchParams.get('size'));
	const range = parseRange(request.headers.get('range'), size);

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

	const body = createStreamRange(size, range.start, range.end);
	const contentLength = range.end - range.start + 1;
	const headers = createHeaders(contentLength);
	headers.set('content-length', String(contentLength));

	if (range.partial) {
		headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
	}

	return new Response(body, {
		status: range.partial ? 206 : 200,
		headers
	});
};