import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * WARRIOR STAGE CONFIGURATION — single source of truth.
 *
 * Only edit the constants in this file to re-map video paths, thresholds or
 * visual intensity. Everything else derives from these.
 */

/** Looping video per stage, index-aligned: index 0 = Stage 0 … index 6 = Stage 6. */
export const WARRIOR_VIDEO_SOURCES: readonly string[] = [
  'assets/warrior/stage-00.mp4', // Stage 0 — Base / default (plays whenever P&L <= 0%)
  'assets/warrior/stage-01.mp4', // Stage 1 — Normal / Awakening
  'assets/warrior/stage-02.mp4', // Stage 2 — Awakening
  'assets/warrior/stage-03.mp4', // Stage 3 — Blue Awakening
  'assets/warrior/stage-04.mp4', // Stage 4 — Super Saiyan Blue
  'assets/warrior/stage-05.mp4', // Stage 5 — Radiant Blue
  'assets/warrior/stage-06.mp4', // Stage 6 — MAX POWER
];

/**
 * P&L% thresholds that advance to the next stage.
 * P&L ≤ 0        → Stage 0 (stage-00.mp4) — default / no open trade / loss
 * 0 < P&L < 0.5  → Stage 1
 * P&L >= 0.5     → Stage 2
 * P&L >= 1.0     → Stage 3
 * P&L >= 1.5     → Stage 4
 * P&L >= 2.0     → Stage 5
 * P&L >= 2.5     → Stage 6 (MAX POWER)
 * Any P&L <= 0 plays stage-00.mp4 — the warrior never powers up on losses.
 */
export const WARRIOR_STAGE_THRESHOLDS: readonly number[] = [0.5, 1.0, 1.5, 2.0, 2.5];

/** Crossfade duration between stage videos (ms). 0 = instant hard cut. */
export const WARRIOR_CROSSFADE_MS = 0;

/**
 * Maps a live P&L percentage to a transformation stage index.
 *   ≤ 0%                 → 0 (stage-00.mp4, base / default / loss state)
 *   0% – <0.50%          → 1 (stage-01.mp4)
 *   0.50% – <1.00%       → 2 (stage-02.mp4)
 *   1.00% – <1.50%       → 3 (stage-03.mp4)
 *   1.50% – <2.00%       → 4 (stage-04.mp4)
 *   2.00% – <2.50%       → 5 (stage-05.mp4)
 *   >=2.50%              → 6 (stage-06.mp4, MAX POWER)
 * Any P&L <= 0 returns 0 — stage-00.mp4 is the default/base video (shown when
 * there is no open trade, i.e. P&L = 0%) and the "P&L < 0%" loss state.
 * The warrior never powers up on losses.
 */
export function getTransformationStage(pnlPercent: number): number {
  if (!Number.isFinite(pnlPercent) || pnlPercent <= 0) {
    return 0; // stage-00.mp4 — default base video & the "P&L <= 0%" state.
  }
  let stage = 1; // stage-01.mp4 for 0% < P&L < 0.5%
  for (let i = 0; i < WARRIOR_STAGE_THRESHOLDS.length; i++) {
    if (pnlPercent >= WARRIOR_STAGE_THRESHOLDS[i]) {
      stage = i + 2; // thresholds[0]=0.5 → index 2 (stage-02) … thresholds[4]=2.5 → index 6 (stage-06)
    } else {
      break;
    }
  }
  return stage;
}

/** Backwards-compatible alias. */
export const warriorStageForPnl = getTransformationStage;


/**
 * Ambient warrior visualization layered over the equity chart.
 *
 * - Driven ONLY by the live P&L percentage (no timers, no randomness).
 * - Uses TWO <video> layers (A = active stage, B = incoming stage); when the
 *   transformation STAGE changes the new video is swapped in INSTANTLY (no
 *   crossfade — WARRIOR_CROSSFADE_MS is 0), but only after it is loaded and
 *   able to play so the cut never flashes a blank frame.
 * - While the stage is stable, the active video keeps looping untouched (no
 *   reload on every P&L tick).
 * - Race-condition safe: if the stage changes mid-transition, it gracefully
 *   transitions from the current visual state to the newest requested stage.
 * - mix-blend-mode: screen so the pure-black video background disappears over
 *   the dark dashboard; pointer-events: none so the chart stays interactive.
 */
@Component({
  selector: 'app-warrior-performance-overlay',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './warrior-performance-overlay.component.html',
  styleUrls: ['./warrior-performance-overlay.component.scss'],
})
export class WarriorPerformanceOverlayComponent implements AfterViewInit, OnChanges, OnDestroy {
  /** Live account P&L percentage, e.g. 1.72. Values <= 0 (no open trade or loss) play stage-00 (Stage 0). */
  @Input() performancePercent = 0;

  /** 0-based transformation stage currently displayed (-1 = not evaluated yet). */
  stage = -1;

  /** The two looping video layers (A and B). */
  @ViewChildren('layer') layers!: QueryList<ElementRef<HTMLVideoElement>>;

  /** Which layer index is currently active (0 or 1). */
  activeLayer = 0;

  private initialized = false;
  private pendingStage = -1;
  /** True while a crossfade is in progress. */
  private transitioning = false;
  /** The stage we are currently fading TOWARDS (may update mid-transition). */
  private targetStage = -1;
  /** Timer used to finalize a crossfade; tracked so it can be cleared. */
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bound 'canplay' listeners attached to incoming videos (for cleanup). */
  private readonly canplayListeners = new Map<HTMLVideoElement, () => void>();

  ngOnChanges(): void {
    const nextStage = getTransformationStage(this.performancePercent);
    if (this.initialized) {
      this.applyStage(nextStage);
    } else {
      // View children are not available yet on the first change — defer to ngAfterViewInit.
      this.pendingStage = nextStage;
    }
  }

  ngAfterViewInit(): void {
    this.initialized = true;
    if (this.pendingStage >= 0) {
      this.applyStage(this.pendingStage);
    }
  }

  ngOnDestroy(): void {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    this.layers?.forEach((l) => {
      const v = l.nativeElement;
      this.detachCanplay(v);
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
  }

  /**
   * Switches the looping video ONLY when the transformation stage actually
   * changes. While the stage is stable the active video keeps looping — we do
   * NOT touch src/load/play on every P&L update. When the stage changes, the
   * other layer's video is swapped in instantly (crossfade disabled).
   */
  private applyStage(nextStage: number): void {
    const videos = this.layers?.toArray().map((l) => l.nativeElement) ?? [];

    if (!videos.length) {
      // Template not rendered yet — remember and retry once the view is ready.
      this.pendingStage = nextStage;
      return;
    }

    // First-ever initialization: set the active layer immediately (no fade).
    if (this.stage < 0) {
      this.stage = nextStage;
      this.targetStage = nextStage;
      this.activeLayer = 0;
      this.loadAndPlay(videos[0], nextStage);
      videos[0].style.opacity = '1';
      videos[1].style.opacity = '0';
      return;
    }

    // Same stage — keep the current video looping untouched. No reload.
    if (nextStage === this.stage && !this.transitioning) {
      return;
    }

    // If a transition is already in progress and the new target is the same as
    // the stage we're already fading towards, do nothing (already handled).
    if (this.transitioning && nextStage === this.targetStage) {
      return;
    }

    this.startCrossfade(nextStage);
  }

  /**
   * Swaps playback from the currently active layer to the other one, loading
   * the new stage's video into the incoming layer and starting it once it is
   * ready to play.
   *
   * Guarantees:
   * - Opacity writes are deferred into requestAnimationFrame after the browser
   *   has painted the incoming layer at opacity:0 (keeps behaviour correct if
   *   a crossfade duration is ever re-enabled).
   * - The swap only happens once the incoming video can actually play (no
   *   dipping to an unloaded/blank frame).
   * - The finalize timer is measured from when the swap actually starts.
   */
  private startCrossfade(toStage: number): void {
    const videos = this.layers?.toArray().map((l) => l.nativeElement) ?? [];
    if (videos.length < 2) {
      this.pendingStage = toStage;
      return;
    }

    const fromStage = this.stage;
    const incomingLayer = this.activeLayer === 0 ? 1 : 0;
    const activeVideo = videos[this.activeLayer];
    const incomingVideo = videos[incomingLayer];

    console.log(
      '[WARRIOR TRANSITION] fromStage:', fromStage,
      'toStage:', toStage,
      'duration:', WARRIOR_CROSSFADE_MS,
      'activeLayer:', this.activeLayer,
      'incomingLayer:', incomingLayer,
    );

    this.targetStage = toStage;
    this.transitioning = true;

    // If a previous transition was mid-flight, clear its finalize timer so we
    // don't double-finalize; the previously-incoming layer becomes the new
    // "active" visual baseline we fade FROM.
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }

    // Load the new stage's video into the incoming layer (muted/inline for autoplay).
    this.loadAndPlay(incomingVideo, toStage);
    incomingVideo.style.opacity = '0';

    // Crossfade the layers. The writes are deferred to the next animation frame
    // so the browser repaints the incoming layer at opacity:0 first, letting the
    // CSS opacity transition actually animate (otherwise the two writes are
    // batched into one frame and the swap is instant / jumpy).
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const beginFade = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      requestAnimationFrame(() => {
        // Re-check: the target may have changed again while we waited.
        if (this.targetStage !== toStage) {
          return;
        }
        incomingVideo.style.opacity = '1';
        activeVideo.style.opacity = '0';

        // Finalize immediately after the swap — duration is 0 (instant cut),
        // measured from when the swap actually starts (not when loading began).
        if (this.transitionTimer) {
          clearTimeout(this.transitionTimer);
        }
        this.transitionTimer = setTimeout(
          () => this.finalizeTransition(toStage, incomingLayer, activeVideo),
          WARRIOR_CROSSFADE_MS,
        );
      });
    };

    // If the video is already ready (e.g. cached / same src), fade immediately.
    if (incomingVideo.readyState >= 2) {
      beginFade();
      return;
    }

    this.attachCanplay(incomingVideo, beginFade);

    // Safety fallback: poll briefly until the incoming video can actually play,
    // so we never fade in an unloaded/blank frame. If it still isn't ready after
    // a generous timeout, fade anyway so the warrior never gets stuck invisible.
    const pollStart = Date.now();
    pollTimer = setInterval(() => {
      if (this.targetStage !== toStage) {
        clearInterval(pollTimer!);
        pollTimer = null;
        return;
      }
      if (incomingVideo.readyState >= 2) {
        clearInterval(pollTimer!);
        pollTimer = null;
        beginFade();
        return;
      }
      if (Date.now() - pollStart > 3000) {
        clearInterval(pollTimer!);
        pollTimer = null;
        beginFade();
      }
    }, 100);
  }

  /** Finalizes a completed crossfade and swaps which layer is "active". */
  private finalizeTransition(
    toStage: number,
    incomingLayer: number,
    activeVideo: HTMLVideoElement,
  ): void {
    this.transitioning = false;
    this.transitionTimer = null;

    // If another stage change arrived during the fade, transition again from
    // the now-active visual state to the newest requested stage.
    if (this.targetStage !== toStage) {
      this.stage = toStage; // intermediate state is now the visual baseline
      this.activeLayer = incomingLayer;
      this.detachCanplay(activeVideo);
      this.resetLayer(activeVideo);
      this.startCrossfade(this.targetStage);
      return;
    }

    this.stage = toStage;
    this.activeLayer = incomingLayer;
    this.detachCanplay(activeVideo);
    this.resetLayer(activeVideo);
  }

  /** Loads `src` into `video`, resets to start, and begins muted looping playback. */
  private loadAndPlay(video: HTMLVideoElement, stage: number): void {
    const src = WARRIOR_VIDEO_SOURCES[stage];
    video.muted = true;
    video.playsInline = true;
    if (video.getAttribute('src') !== src) {
      video.setAttribute('src', src);
    }
    video.currentTime = 0;
    video.load();
    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => {
        /* muted autoplay is normally permitted; ignore transient rejections */
      });
    }
  }

  /** Pauses and releases the source of a layer that is no longer active. */
  private resetLayer(video: HTMLVideoElement): void {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  /** Attaches a one-shot `canplay` listener (tracked for later cleanup). */
  private attachCanplay(video: HTMLVideoElement, handler: () => void): void {
    this.detachCanplay(video);
    const listener = () => {
      video.removeEventListener('canplay', listener);
      handler();
    };
    this.canplayListeners.set(video, listener);
    video.addEventListener('canplay', listener);
  }

  /** Removes any tracked `canplay` listener from the given video. */
  private detachCanplay(video: HTMLVideoElement): void {
    const listener = this.canplayListeners.get(video);
    if (listener) {
      video.removeEventListener('canplay', listener);
      this.canplayListeners.delete(video);
    }
  }
}
