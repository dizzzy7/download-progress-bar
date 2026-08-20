const defaultSize = 25 * 1024 * 1024;
const chunkSize = 64 * 1024;

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseDownloadSize(value: string | null) {
	if (!value) {
		return defaultSize;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return defaultSize;
	}

	return Math.floor(parsed);
}

export function parseDownloadRange(rangeHeader: string | null, size: number) {
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

export function createDownloadStream(
	size: number,
	start: number,
	end = size - 1,
	chunkDelayMs = 0
) {
	let isClosed = false;

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			let sent = start;
			const chunk = new Uint8Array(Math.min(chunkSize, size));

			const push = () => {
				if (isClosed) {
					return;
				}

				while (sent <= end) {
					const nextSize = Math.min(chunkSize, end - sent + 1);
					controller.enqueue(nextSize === chunk.length ? chunk : chunk.slice(0, nextSize));
					sent += nextSize;
					if (sent <= end) {
						if (chunkDelayMs > 0) {
							delay(chunkDelayMs).then(push);
						} else {
							queueMicrotask(push);
						}
						return;
					}
				}

				isClosed = true;
				controller.close();
			};

			push();
		},
		cancel() {
			isClosed = true;
		}
	});
}

export function createDownloadHeaders(size: number) {
	return new Headers({
		'cache-control': 'no-store',
		'content-length': String(size),
		'content-type': 'application/octet-stream',
		'accept-ranges': 'bytes',
		'content-disposition': 'attachment; filename="demo-download.bin"'
	});
}