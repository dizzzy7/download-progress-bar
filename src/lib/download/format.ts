export function formatBytes(bytes: number) {
	if (!Number.isFinite(bytes) || bytes < 1024) {
		return `${Math.max(0, Math.round(bytes))} B`;
	}

	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unitIndex = 0;

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatElapsed(milliseconds: number) {
	return `${(milliseconds / 1000).toFixed(1)}s`;
}