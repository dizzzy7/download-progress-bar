
<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { formatBytes, formatElapsed } from '$lib/download/format';
	import {
		getSizeHint,
		loadSizeHints,
		persistSizeHint,
		resolveDownloadUrl,
		type SizeHints
	} from '$lib/download/size-hints';
	type DownloadMode = 'idle' | 'downloading' | 'paused' | 'complete' | 'error';

	const defaultDownloadUrl = '/api/download?size=26214400';
	const slowDownloadUrl = '/api/download?size=26214400&delay=40';
	const remoteSampleUrl = 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg';

	let downloadUrl = $state(defaultDownloadUrl);
	let useSlowDemo = $state(false);
	let sourceMode = $state<'local' | 'remote'>('local');
	let downloadMode = $state<DownloadMode>('idle');
	let currentSourceLabel = $state('Local demo file');
	let statusMessage = $state('Ready to download');
	let errorMessage = $state('');
	let downloadedBytes = $state(0);
	let totalBytes = $state<number | null>(null);
	let progressValue = $state(0);
	let speedBytesPerSecond = $state(0);
	let elapsedSeconds = $state(0);
	let rememberedBytes = $state<number | null>(null);
	let usedEstimatedSize = $state(false);
	let lastSuccessfulSize = $state<number | null>(null);
	let supportsRange = $state(false);
	let canResume = $state(false);
	let abortController = $state<AbortController | null>(null);
	let sizeHints = $state<SizeHints>({});
	let shouldPause = $state(false);
	let shouldReset = $state(false);
	let sessionStartedAt = $state(0);
	let pauseStartedAt = $state(0);
	let pausedMilliseconds = $state(0);
	let activeRequestId = $state(0);

	onMount(() => {
		if (!browser) {
			return;
		}

		sizeHints = loadSizeHints(window.localStorage);

		rememberedBytes = getSizeHint(sizeHints, downloadUrl, window.location.href);
	});

	$effect(() => {
		if (browser && downloadMode !== 'downloading') {
			rememberedBytes = getSizeHint(sizeHints, downloadUrl, window.location.href);
		}
	});

	function updateProgress() {
		if (totalBytes && totalBytes > 0) {
			progressValue = Math.min(100, (downloadedBytes / totalBytes) * 100);
			return;
		}

		progressValue = Math.min(92, 6 + Math.log10(downloadedBytes + 1) * 18);
	}

	function resetCurrentDownloadState(message = 'Ready to download') {
		downloadMode = 'idle';
		statusMessage = message;
		errorMessage = '';
		downloadedBytes = 0;
		totalBytes = null;
		progressValue = 0;
		speedBytesPerSecond = 0;
		elapsedSeconds = 0;
		usedEstimatedSize = false;
		supportsRange = false;
		canResume = false;
		sessionStartedAt = 0;
		pauseStartedAt = 0;
		pausedMilliseconds = 0;
	}

	function refreshLocalSourceLabel() {
		currentSourceLabel = useSlowDemo ? 'Local demo file (slow)' : 'Local demo file';
	}

	function refreshLocalDemoUrl() {
		downloadUrl = useSlowDemo ? slowDownloadUrl : defaultDownloadUrl;
		refreshLocalSourceLabel();
	}

	function updateElapsed(now = performance.now()) {
		elapsedSeconds = (now - sessionStartedAt - pausedMilliseconds) / 1000;
	}

	function setLocalSource() {
		sourceMode = 'local';
		refreshLocalDemoUrl();
		if (downloadMode !== 'downloading') {
			rememberedBytes = getSizeHint(sizeHints, downloadUrl, window.location.href);
		}
	}

	function toggleSlowDemo() {
		useSlowDemo = !useSlowDemo;
		if (sourceMode === 'local') {
			refreshLocalDemoUrl();
			if (downloadMode !== 'downloading') {
				rememberedBytes = getSizeHint(sizeHints, downloadUrl, window.location.href);
			}
		}
	}

	const isSlowDemoActive = $derived(useSlowDemo);

	function setRemoteSource() {
		sourceMode = 'remote';
		downloadUrl = remoteSampleUrl;
		currentSourceLabel = 'Remote sample file';
		if (downloadMode !== 'downloading') {
			rememberedBytes = getSizeHint(sizeHints, downloadUrl, window.location.href);
		}
	}

	function primaryLabel() {
		if (downloadMode === 'downloading') {
			return 'Pause';
		}

		if (downloadMode === 'paused') {
			return 'Resume';
		}

		if (downloadMode === 'complete') {
			return 'Download again';
		}

		return 'Start download';
	}

	function secondaryLabel() {
		if (downloadMode === 'downloading' || downloadMode === 'paused') {
			return 'Cancel';
		}

		return 'Reset';
	}

	async function fetchKnownSize(resolvedUrl: string) {
		try {
			const headResponse = await fetch(resolvedUrl, {
				method: 'HEAD'
			});

			if (headResponse.ok) {
				const contentLength = headResponse.headers.get('content-length');
				if (contentLength) {
					const parsedLength = Number(contentLength);
					if (Number.isFinite(parsedLength) && parsedLength > 0) {
						totalBytes = parsedLength;
						return;
					}
				}
			}
		} catch {
			// Fall back to the remembered rough estimate.
		}

		if (!totalBytes && rememberedBytes) {
			totalBytes = rememberedBytes;
			usedEstimatedSize = true;
		}
	}

	async function runDownload(resume = false) {
		if (downloadMode === 'downloading') {
			return;
		}

		if (typeof window === 'undefined') {
			return;
		}

		shouldPause = false;
		shouldReset = false;
		errorMessage = '';

		if (!resume) {
			resetCurrentDownloadState('Preparing download...');
			downloadedBytes = 0;
			lastSuccessfulSize = null;
		} else {
			downloadMode = 'downloading';
			statusMessage = 'Resuming download...';
		}

		usedEstimatedSize = false;
		rememberedBytes = getSizeHint(sizeHints, downloadUrl, window.location.href);

		const resolvedUrl = resolveDownloadUrl(downloadUrl, window.location.href);
		const offset = resume ? downloadedBytes : 0;
		const requestId = ++activeRequestId;
		abortController = new AbortController();

		if (!resume) {
			await fetchKnownSize(resolvedUrl);
		}

		if (!sessionStartedAt) {
			sessionStartedAt = performance.now();
		}

		if (pauseStartedAt) {
			pausedMilliseconds += performance.now() - pauseStartedAt;
			pauseStartedAt = 0;
		}

		downloadMode = 'downloading';
		statusMessage = offset > 0 ? 'Continuing download...' : 'Downloading...';

		try {
			const response = await fetch(resolvedUrl, {
				signal: abortController.signal,
				headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined
			});

			if (requestId !== activeRequestId) {
				return;
			}

			if (offset > 0 && response.status !== 206) {
				throw new Error('This source does not support resuming from a byte offset.');
			}

			supportsRange = response.headers.get('accept-ranges') === 'bytes' || response.status === 206;
			canResume = supportsRange;

			const contentRange = response.headers.get('content-range');
			const contentLength = response.headers.get('content-length');

			if (contentRange) {
				const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(contentRange);
				if (match) {
					const totalFromRange = Number(match[3]);
					if (Number.isFinite(totalFromRange) && totalFromRange > 0) {
						totalBytes = totalFromRange;
					}
				}
			} else if (contentLength) {
				const parsedLength = Number(contentLength);
				if (Number.isFinite(parsedLength) && parsedLength > 0) {
					totalBytes = offset > 0 ? offset + parsedLength : parsedLength;
				}
			}

			if (!totalBytes && rememberedBytes) {
				totalBytes = rememberedBytes;
				usedEstimatedSize = true;
			}

			if (!response.body) {
				throw new Error('This browser response does not expose a readable body stream.');
			}

			const reader = response.body.getReader();
			let lastTickAt = performance.now();
			let lastDownloadedBytes = downloadedBytes;

			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				downloadedBytes += value.byteLength;
				const now = performance.now();
				updateElapsed(now);

				if (now > lastTickAt) {
					speedBytesPerSecond =
						((downloadedBytes - lastDownloadedBytes) * 1000) / (now - lastTickAt);
					lastTickAt = now;
					lastDownloadedBytes = downloadedBytes;
				}

				updateProgress();
				statusMessage = usedEstimatedSize
					? 'Downloading with a remembered size estimate'
					: totalBytes
						? 'Downloading with a known size'
						: 'Downloading without a known size';
			}

			const finalSize = downloadedBytes;
			sizeHints = persistSizeHint(
				sizeHints,
				downloadUrl,
				finalSize,
				window.localStorage,
				window.location.href
			);
			rememberedBytes = finalSize;
			lastSuccessfulSize = finalSize;
			totalBytes = finalSize;
			progressValue = 100;
			downloadMode = 'complete';
			canResume = false;
			statusMessage = `Downloaded ${formatBytes(finalSize)} successfully`;
		} catch (error) {
			if (abortController?.signal.aborted) {
				if (shouldPause) {
					downloadMode = 'paused';
					canResume = downloadedBytes > 0 && supportsRange;
					pauseStartedAt = performance.now();
					statusMessage = `Paused at ${formatBytes(downloadedBytes)}`;
					return;
				}

				if (shouldReset) {
					resetCurrentDownloadState('Ready to download');
					return;
				}

				statusMessage = 'Download cancelled';
				downloadMode = 'idle';
				return;
			}

			errorMessage = error instanceof Error ? error.message : 'The download failed.';
			downloadMode = 'error';
			statusMessage = 'Download failed';
		} finally {
			if (downloadMode !== 'paused') {
				pauseStartedAt = 0;
			}

			abortController = null;
			speedBytesPerSecond = 0;
			shouldPause = false;
			shouldReset = false;
		}
	}

	function togglePrimaryAction() {
		if (downloadMode === 'downloading') {
			shouldPause = true;
			abortController?.abort();
			return;
		}

		if (downloadMode === 'paused') {
			void runDownload(true);
			return;
		}

		void runDownload(false);
	}

	function resetDownload() {
		if (downloadMode === 'downloading' || downloadMode === 'paused') {
			shouldReset = true;
			shouldPause = false;
			abortController?.abort();
			return;
		}

		resetCurrentDownloadState('Ready to download');
	}
</script>

<svelte:head>
	<title>Download Progress Bar</title>
	<meta
		name="description"
		content="A fetch-driven download progress demo that remembers previous file sizes as rough estimates."
	/>
</svelte:head>

<div class="shell">
	<section class="hero">
		<div class="eyebrow">Fetch-driven download progress</div>
		<h1>Remember the last size, then use it to resume and estimate better next time.</h1>
		<p>
			This demo supports a local streamed file and a remote URL. It remembers the last successful
			size as a rough estimate, and the download can be paused and resumed when the source supports
			Range requests.
		</p>
	</section>

	<section class="panel">
		<div class="source-row">
			<div>
				<div class="label">Source</div>
				<div class="value">{currentSourceLabel}</div>
			</div>

			<div class="source-actions">
				<button class="secondary" type="button" onclick={setLocalSource}>Use local demo</button>
				<button class="secondary" type="button" onclick={toggleSlowDemo}>
					{isSlowDemoActive ? 'Slow demo: on' : 'Slow demo: off'}
				</button>
				<button class="secondary" type="button" onclick={setRemoteSource}>Use remote sample</button>
			</div>
		</div>

		<label class="field" for="download-url">
			<span>Download URL</span>
			<input id="download-url" bind:value={downloadUrl} spellcheck="false" />
		</label>

		<p class="helper">
			Remote URLs must allow CORS, and pause/resume works best when the source supports byte-range
			requests. The slow demo intentionally drips out data so the progress bar is easy to watch.
		</p>

		<div class="actions">
			<button class="primary" type="button" onclick={togglePrimaryAction}>
				{primaryLabel()}
			</button>
			<button class="secondary" type="button" onclick={resetDownload}>
				{secondaryLabel()}
			</button>
		</div>

		<div class="progress-card" aria-live="polite">
			<div class="progress-track" aria-hidden="true">
				<div
					class:indeterminate={!totalBytes}
					class:paused={downloadMode === 'paused'}
					class="progress-fill"
					style={`width: ${progressValue}%`}
				></div>
				<div class="progress-percentage">
					{totalBytes ? `${Math.round(progressValue)}%` : '—'}
				</div>
			</div>

			<div class="progress-meta">
				<div>
					<div class="label">Status</div>
					<div class="value">{statusMessage}</div>
				</div>

				<div>
					<div class="label">Downloaded</div>
					<div class="value">{formatBytes(downloadedBytes)}</div>
				</div>

				<div>
					<div class="label">Expected total</div>
					<div class="value">{totalBytes ? formatBytes(totalBytes) : 'Unknown'}</div>
				</div>

				<div>
					<div class="label">Speed</div>
					<div class="value">
						{speedBytesPerSecond > 0 ? `${formatBytes(speedBytesPerSecond)}/s` : '—'}
					</div>
				</div>

				<div>
					<div class="label">Elapsed</div>
					<div class="value">{formatElapsed(elapsedSeconds * 1000)}</div>
				</div>

				<div>
					<div class="label">Remembered estimate</div>
					<div class="value">
						{rememberedBytes ? formatBytes(rememberedBytes) : 'None yet'}
					</div>
				</div>
			</div>

			{#if usedEstimatedSize}
				<p class="hint">Using the last successful size as a rough estimate for this download.</p>
			{/if}

			{#if downloadMode === 'paused' && canResume}
				<p class="hint">Paused safely. Resume will continue from the last downloaded byte.</p>
			{/if}

			{#if lastSuccessfulSize}
				<p class="hint subtle">
					Last successful download updated the stored size to {formatBytes(lastSuccessfulSize)}.
				</p>
			{/if}

			{#if errorMessage}
				<p class="error">{errorMessage}</p>
			{/if}
		</div>
	</section>
</div>

<style>
	:global(body) {
		margin: 0;
		min-height: 100vh;
		font-family: 'Aptos', 'Segoe UI', system-ui, sans-serif;
		color: #f5efe6;
		background:
			radial-gradient(circle at top left, rgba(255, 176, 91, 0.24), transparent 32%),
			radial-gradient(circle at top right, rgba(80, 169, 255, 0.2), transparent 30%),
			linear-gradient(180deg, #101827 0%, #111318 45%, #080b12 100%);
	}

	.shell {
		min-height: 100vh;
		padding: 48px 20px 64px;
		display: grid;
		gap: 24px;
		place-items: center;
	}

	.hero,
	.panel {
		width: min(100%, 960px);
	}

	.hero {
		padding: 12px 0 4px;
	}

	.eyebrow {
		display: inline-flex;
		padding: 8px 12px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		font-size: 0.74rem;
		color: #ffd7b0;
	}

	h1 {
		margin: 18px 0 12px;
		font-size: clamp(2.4rem, 5vw, 4.8rem);
		line-height: 0.95;
		letter-spacing: -0.05em;
		max-width: 14ch;
	}

	p {
		margin: 0;
		max-width: 64ch;
		line-height: 1.65;
		color: rgba(245, 239, 230, 0.8);
	}

	.panel {
		padding: 24px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 28px;
		background: rgba(12, 16, 26, 0.8);
		backdrop-filter: blur(18px);
		box-shadow: 0 28px 80px rgba(0, 0, 0, 0.34);
	}

	.source-row {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: center;
		margin-bottom: 18px;
	}

	.source-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.field {
		display: grid;
		gap: 10px;
		margin-bottom: 14px;
	}

	.label {
		font-size: 0.78rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: rgba(245, 239, 230, 0.6);
	}

	.field span {
		font-size: 0.86rem;
		color: rgba(245, 239, 230, 0.72);
	}

	.value {
		margin-top: 6px;
		font-size: 1rem;
		color: #fff8ef;
	}

	input {
		padding: 14px 16px;
		border-radius: 16px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.05);
		color: inherit;
		font: inherit;
	}

	input:focus {
		outline: 2px solid rgba(255, 180, 100, 0.5);
		outline-offset: 2px;
	}

	.helper {
		margin-bottom: 18px;
		font-size: 0.95rem;
		color: rgba(245, 239, 230, 0.68);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 22px;
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 12px 18px;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
		transition:
			transform 120ms ease,
			opacity 120ms ease,
			background 120ms ease;
	}

	button:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.primary {
		background: linear-gradient(135deg, #ffb15f, #ff7b54);
		color: #111318;
	}

	.secondary {
		background: rgba(255, 255, 255, 0.08);
		color: inherit;
	}

	.progress-card {
		display: grid;
		gap: 18px;
	}

	.progress-track {
		position: relative;
		height: 16px;
		overflow: hidden;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
	}

	.progress-fill {
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, #87e8ff, #ffd27d 55%, #ff8f70);
		box-shadow: 0 0 24px rgba(255, 178, 120, 0.34);
		transition: width 120ms linear;
	}

	.progress-fill.indeterminate {
		background-size: 200% 100%;
		animation: shimmer 1.1s linear infinite;
	}

	.progress-fill.paused {
		animation-play-state: paused;
	}

	.progress-percentage {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 0.875rem;
		font-weight: 600;
		color: #ffffff;
		text-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
		pointer-events: none;
	}

	.progress-meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 14px 16px;
	}

	.hint,
	.error {
		padding: 12px 14px;
		border-radius: 16px;
		margin: 0;
	}

	.hint {
		background: rgba(135, 232, 255, 0.08);
		border: 1px solid rgba(135, 232, 255, 0.18);
		color: #d6f7ff;
	}

	.hint.subtle {
		background: rgba(255, 255, 255, 0.04);
		border-color: rgba(255, 255, 255, 0.08);
		color: rgba(245, 239, 230, 0.72);
	}

	.error {
		background: rgba(255, 107, 107, 0.1);
		border: 1px solid rgba(255, 107, 107, 0.18);
		color: #ffd5d5;
	}

	@keyframes shimmer {
		from {
			background-position: 0% 50%;
		}

		to {
			background-position: 200% 50%;
		}
	}

	@media (max-width: 720px) {
		.source-row {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	@media (max-width: 640px) {
		.shell {
			padding: 20px 12px 32px;
		}

		.panel {
			padding: 18px;
			border-radius: 22px;
		}

		h1 {
			max-width: 10ch;
		}
	}
</style>
