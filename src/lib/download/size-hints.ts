export type SizeHints = Record<string, number>;

export const sizeHintsStorageKey = 'download-progress-bar:size-hints';

export function resolveDownloadUrl(value: string, baseUrl: string) {
	return new URL(value, baseUrl).href;
}

export function loadSizeHints(storage: Storage | undefined) {
	if (!storage) {
		return {} as SizeHints;
	}

	try {
		const storedHints = storage.getItem(sizeHintsStorageKey);
		return storedHints ? (JSON.parse(storedHints) as SizeHints) : {};
	} catch {
		return {} as SizeHints;
	}
}

export function getSizeHint(sizeHints: SizeHints, value: string, baseUrl: string) {
	return sizeHints[resolveDownloadUrl(value, baseUrl)] ?? null;
}

export function persistSizeHint(
	sizeHints: SizeHints,
	value: string,
	bytes: number,
	storage: Storage | undefined,
	baseUrl: string
) {
	const key = resolveDownloadUrl(value, baseUrl);
	const nextSizeHints = {
		...sizeHints,
		[key]: bytes
	};

	storage?.setItem(sizeHintsStorageKey, JSON.stringify(nextSizeHints));

	return nextSizeHints;
}