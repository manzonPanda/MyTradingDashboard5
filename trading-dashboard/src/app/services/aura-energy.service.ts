import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { AuraEnergySettings, SupabaseService } from './supabase.service';

interface RouteBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
}

export interface AuraEnergyConfig {
  enabled: boolean;
  travelDurationMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  trailLengthPercent: number;
  strokeWidth: number;
  headRadius: number;
  bloomIntensity: number;
  fadeDurationMs: number;
  colorStart: string;
  colorMid: string;
  colorPeak: string;
  colorHead: string;
  minTargets: number;
  maxTargets: number;
}

export const DEFAULT_AURA_ENERGY_CONFIG: AuraEnergyConfig = {
  enabled: true,
  travelDurationMs: 2000,
  minDelayMs: 2000,
  maxDelayMs: 5000,
  trailLengthPercent: 8,
  strokeWidth: 3,
  headRadius: 7,
  bloomIntensity: 3.5,
  fadeDurationMs: 180,
  colorStart: '#7C3AED',
  colorMid: '#A78BFA',
  colorPeak: '#E9D5FF',
  colorHead: '#FFFFFF',
  minTargets: 2,
  maxTargets: 4
};

@Injectable({ providedIn: 'root' })
export class AuraEnergyService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly supabaseService = inject(SupabaseService);
  private readonly authService = inject(AuthService);
  private timerId?: number;
  private fadeId?: number;
  private frameId?: number;
  private resizeObserver?: ResizeObserver;
  private activeOverlay?: HTMLDivElement;
  private auraContainer?: HTMLElement;
  private activeTargets: HTMLElement[] = [];
  private routePath = '';
  private previousRoute = '';
  private routeLength = 0;
  private routeStartCorner = 0;
  private progress = 0;
  private isAuraTraveling = false;
  private isDestroyed = false;
  private travelStartTime = 0;
  private dissipationStartTime = 0;
  private isDissipating = false;
  private config: AuraEnergyConfig = { ...DEFAULT_AURA_ENERGY_CONFIG };

  getConfig(): AuraEnergyConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<AuraEnergyConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...partial };

    if (!this.config.enabled) {
      this.clearTimer();
      this.clearFadeTimer();
      this.finishTraveler();
      return;
    }

    if (!wasEnabled && this.config.enabled) {
      this.start();
      return;
    }

    // If currently traveling, refresh the overlay visuals to reflect new config
    if (this.isAuraTraveling && this.activeOverlay) {
      this.refreshOverlayAppearance();
    }
  }

  async saveConfig(config: AuraEnergyConfig = this.config): Promise<AuraEnergyConfig> {
    const userId = this.authService.user()?.id;
    if (!userId) throw new Error('No authenticated user exists.');

    const settings = await this.supabaseService.updateAuraEnergySettings(userId, this.toSettings(config));
    this.config = this.fromSettings(settings);
    return this.getConfig();
  }

  private toSettings(config: AuraEnergyConfig): AuraEnergySettings {
    return {
      aura_enabled: config.enabled,
      aura_travel_duration_ms: config.travelDurationMs,
      aura_min_delay_ms: config.minDelayMs,
      aura_max_delay_ms: config.maxDelayMs,
      aura_trail_length_percent: config.trailLengthPercent,
      aura_stroke_width: config.strokeWidth,
      aura_head_radius: config.headRadius,
      aura_bloom_intensity: config.bloomIntensity,
      aura_fade_duration_ms: config.fadeDurationMs,
      aura_color_start: config.colorStart,
      aura_color_mid: config.colorMid,
      aura_color_peak: config.colorPeak,
      aura_color_head: config.colorHead,
      aura_min_targets: config.minTargets,
      aura_max_targets: config.maxTargets
    };
  }

  private fromSettings(settings: AuraEnergySettings): AuraEnergyConfig {
    return {
      enabled: settings.aura_enabled,
      travelDurationMs: Number(settings.aura_travel_duration_ms),
      minDelayMs: Number(settings.aura_min_delay_ms),
      maxDelayMs: Number(settings.aura_max_delay_ms),
      trailLengthPercent: Number(settings.aura_trail_length_percent),
      strokeWidth: Number(settings.aura_stroke_width),
      headRadius: Number(settings.aura_head_radius),
      bloomIntensity: Number(settings.aura_bloom_intensity),
      fadeDurationMs: Number(settings.aura_fade_duration_ms),
      colorStart: settings.aura_color_start,
      colorMid: settings.aura_color_mid,
      colorPeak: settings.aura_color_peak,
      colorHead: settings.aura_color_head,
      minTargets: Number(settings.aura_min_targets),
      maxTargets: Number(settings.aura_max_targets)
    };
  }

  start(): void {
    if (this.prefersReducedMotion() || this.isDestroyed || this.isAuraTraveling || this.timerId) {
      return;
    }
    if (!this.config.enabled) {
      return;
    }

    this.zone.runOutsideAngular(() => this.scheduleNextPulse(this.randomDelay()));
  }

  destroy(): void {
    this.isDestroyed = true;
    this.clearTimer();
    this.clearFadeTimer();
    this.finishTraveler();
  }

  private scheduleNextPulse(delay: number): void {
    if (this.isDestroyed || this.isAuraTraveling || this.timerId || !this.config.enabled) {
      return;
    }

    this.timerId = window.setTimeout(() => {
      this.timerId = undefined;
      if (!this.isDestroyed && !this.prefersReducedMotion() && !this.isAuraTraveling && this.config.enabled) {
        this.startTraveler();
      }
    }, delay);
  }

  private startTraveler(): void {
    if (this.isDestroyed || this.isAuraTraveling || !this.config.enabled) {
      return;
    }

    this.auraContainer = this.document.querySelector<HTMLElement>('.tradezella-dashboard') || undefined;
    if (!this.auraContainer) {
      this.scheduleNextPulse(this.randomDelay());
      return;
    }

    this.activeTargets = this.selectRandomTargets();
    this.routeStartCorner = Math.floor(Math.random() * 4);
    if (!this.activeTargets.length) {
      this.scheduleNextPulse(this.randomDelay());
      return;
    }

    this.activeOverlay = this.createOverlay();
    this.auraContainer.append(this.activeOverlay);
    this.isAuraTraveling = true;
    this.progress = 0;
    this.updateRoute();

    if (!this.routePath) {
      this.finishTraveler();
      this.scheduleNextPulse(this.randomDelay());
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.requestRouteUpdate());
    this.resizeObserver.observe(this.auraContainer);
    this.activeTargets.forEach((target) => this.resizeObserver?.observe(target));
    window.addEventListener('scroll', this.requestRouteUpdate, true);
    window.addEventListener('resize', this.requestRouteUpdate);
    this.frameId = window.requestAnimationFrame(this.animateTraveler);
  }

  private selectRandomTargets(): HTMLElement[] {
    const targets = Array.from(this.document.querySelectorAll<HTMLElement>('[data-aura-target]'))
      .filter((target) => this.isEligibleTarget(target));
    const minCount = Math.max(1, this.config.minTargets);
    const maxCount = Math.max(minCount, this.config.maxTargets);
    const count = Math.min(targets.length, minCount + Math.floor(Math.random() * (maxCount - minCount + 1)));

    return this.shuffle(targets).slice(0, count).sort((first, second) => {
      const firstBounds = first.getBoundingClientRect();
      const secondBounds = second.getBoundingClientRect();
      return firstBounds.top - secondBounds.top || firstBounds.left - secondBounds.left;
    });
  }

  private createOverlay(): HTMLDivElement {
    const overlay = this.document.createElement('div');
    overlay.className = 'aura-energy-pulse';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = this.buildOverlaySvg();
    return overlay;
  }

  private buildOverlaySvg(): string {
    const { colorStart, colorMid, colorPeak, colorHead, bloomIntensity, strokeWidth, headRadius } = this.config;
    const softBlur = Math.max(0.4, bloomIntensity * 0.31).toFixed(2);
    return `
      <svg class="aura-energy-svg" focusable="false" preserveAspectRatio="none">
        <defs>
          <linearGradient id="aura-energy-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="${colorStart}" stop-opacity="0.2" />
            <stop offset="50%" stop-color="${colorMid}" stop-opacity="0.65" />
            <stop offset="82%" stop-color="${colorPeak}" stop-opacity="0.95" />
            <stop offset="100%" stop-color="${colorHead}" />
          </linearGradient>
          <filter id="aura-energy-bloom" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="${bloomIntensity}" result="wide-blur" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="${softBlur}" result="soft-blur" />
            <feMerge><feMergeNode in="wide-blur" /><feMergeNode in="soft-blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path id="aura-route" fill="none" stroke="none" />
        <path id="aura-trail" class="aura-energy-line" stroke-width="${strokeWidth}" />
        <circle class="aura-energy-head" r="${headRadius}" fill="${colorHead}" />
      </svg>`;
  }

  private refreshOverlayAppearance(): void {
    if (!this.activeOverlay) {
      return;
    }
    const svg = this.activeOverlay.querySelector<SVGSVGElement>('.aura-energy-svg');
    if (!svg) {
      return;
    }

    svg.innerHTML = this.buildOverlaySvgInner();
    const route = svg.querySelector<SVGPathElement>('#aura-route');
    if (!route || !this.routePath) {
      return;
    }

    route.setAttribute('d', this.routePath);
    this.routeLength = route.getTotalLength();
    this.renderTraveler();
  }

  private buildOverlaySvgInner(): string {
    const { colorStart, colorMid, colorPeak, colorHead, bloomIntensity, strokeWidth, headRadius } = this.config;
    const softBlur = Math.max(0.4, bloomIntensity * 0.31).toFixed(2);
    return `
        <defs>
          <linearGradient id="aura-energy-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="${colorStart}" stop-opacity="0.2" />
            <stop offset="50%" stop-color="${colorMid}" stop-opacity="0.65" />
            <stop offset="82%" stop-color="${colorPeak}" stop-opacity="0.95" />
            <stop offset="100%" stop-color="${colorHead}" />
          </linearGradient>
          <filter id="aura-energy-bloom" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="${bloomIntensity}" result="wide-blur" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="${softBlur}" result="soft-blur" />
            <feMerge><feMergeNode in="wide-blur" /><feMergeNode in="soft-blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path id="aura-route" fill="none" stroke="none" />
        <path id="aura-trail" class="aura-energy-line" stroke-width="${strokeWidth}" />
        <circle class="aura-energy-head" r="${headRadius}" fill="${colorHead}" />`;
  }

  private animateTraveler = (timestamp: number): void => {
    if (!this.isAuraTraveling || !this.activeOverlay || !this.routeLength) {
      return;
    }

    if (!this.travelStartTime) {
      this.travelStartTime = timestamp;
    }
    this.progress = Math.min(1, (timestamp - this.travelStartTime) / this.config.travelDurationMs);
    this.renderTraveler();

    if (this.progress >= 1) {
      if (!this.isDissipating) {
        this.isDissipating = true;
        this.dissipationStartTime = timestamp;
      }

      const dissipationProgress = Math.min(1, (timestamp - this.dissipationStartTime) / this.config.fadeDurationMs);
      this.renderDissipation(dissipationProgress);
      if (dissipationProgress >= 1) {
        this.finishTraveler();
        this.scheduleNextPulse(this.randomDelay());
        return;
      }
    }

    this.frameId = window.requestAnimationFrame(this.animateTraveler);
  };

  private renderTraveler(): void {
    const route = this.activeOverlay?.querySelector<SVGPathElement>('#aura-route');
    const trail = this.activeOverlay?.querySelector<SVGPathElement>('#aura-trail');
    const head = this.activeOverlay?.querySelector<SVGCircleElement>('.aura-energy-head');
    if (!route || !trail || !head) {
      return;
    }

    const distance = this.routeLength * this.progress;
    const trailLength = Math.max(60, this.routeLength * (this.config.trailLengthPercent / 100));
    this.renderTrail(route, trail, Math.max(0, distance - trailLength), distance);
    const headPoint = route.getPointAtLength(distance);
    head.setAttribute('cx', `${headPoint.x}`);
    head.setAttribute('cy', `${headPoint.y}`);
  }

  private renderDissipation(progress: number): void {
    const route = this.activeOverlay?.querySelector<SVGPathElement>('#aura-route');
    const trail = this.activeOverlay?.querySelector<SVGPathElement>('#aura-trail');
    const head = this.activeOverlay?.querySelector<SVGCircleElement>('.aura-energy-head');
    if (!route || !trail || !head) {
      return;
    }

    const trailLength = Math.max(60, this.routeLength * (this.config.trailLengthPercent / 100));
    const initialTrailStart = Math.max(0, this.routeLength - trailLength);
    const headFadeProgress = Math.min(1, progress / 0.4);
    const trailRetractionProgress = Math.max(0, (progress - 0.4) / 0.6);
    const trailStart = initialTrailStart + trailLength * trailRetractionProgress;

    head.style.opacity = `${1 - headFadeProgress}`;
    this.renderTrail(route, trail, Math.min(trailStart, this.routeLength), this.routeLength);
  }

  private renderTrail(route: SVGPathElement, trail: SVGPathElement, startDistance: number, endDistance: number): void {
    if (endDistance <= startDistance) {
      trail.setAttribute('d', '');
      return;
    }

    const samples = 12;
    let trailPath = '';
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const d = startDistance + (endDistance - startDistance) * t;
      const p = route.getPointAtLength(d);
      trailPath += i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`;
    }
    trail.setAttribute('d', trailPath);
  }

  private requestRouteUpdate = (): void => {
    if (!this.frameId) {
      this.frameId = window.requestAnimationFrame(() => {
        this.frameId = undefined;
        this.updateRoute();
        this.renderTraveler();
      });
    }
  };

  private updateRoute(): void {
    if (!this.activeOverlay || !this.auraContainer) {
      return;
    }

    const svg = this.activeOverlay.querySelector<SVGSVGElement>('.aura-energy-svg');
    const route = this.activeOverlay.querySelector<SVGPathElement>('#aura-route');
    if (!svg || !route) {
      return;
    }

    const containerRect = this.auraContainer.getBoundingClientRect();
    const width = this.auraContainer.clientWidth;
    const height = this.auraContainer.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', `${width}`);
    svg.setAttribute('height', `${height}`);

    const routeData = this.activeTargets
      .map((target) => ({ target, bounds: target.getBoundingClientRect() }))
      .filter(({ bounds }) => bounds.width > 0 && bounds.height > 0)
      .map(({ target, bounds }) => {
        const style = window.getComputedStyle(target);
        const radius = Math.min(this.parseRadius(style.borderTopLeftRadius), bounds.width / 2, bounds.height / 2);
        return {
          left: bounds.left - containerRect.left - 1.5,
          top: bounds.top - containerRect.top - 1.5,
          right: bounds.right - containerRect.left + 1.5,
          bottom: bounds.bottom - containerRect.top + 1.5,
          radius
        };
      });

    if (!routeData.length) {
      return;
    }

    let path = this.roundedRectPath(routeData[0], false, routeData.length > 1, this.routeStartCorner);
    for (let index = 1; index < routeData.length; index += 1) {
      const connector = this.createOrthogonalConnector(routeData[index - 1], routeData[index]);
      const isLastTarget = index === routeData.length - 1;
      path += connector + this.roundedRectPath(routeData[index], true, !isLastTarget);
    }

    if (path === this.previousRoute && this.activeTargets.length > 1) {
      this.activeTargets = this.selectRandomTargets();
      this.updateRoute();
      return;
    }

    this.routePath = path;
    this.previousRoute = path;
    route.setAttribute('d', path);
    this.routeLength = route.getTotalLength();
    this.renderTraveler();
  }

  private roundedRectPath(box: RouteBox, continuation = false, close = true, startCorner = 0): string {
    const { left, top, right, bottom, radius } = box;
    const start = continuation ? '' : this.roundedRectStart(box, startCorner);
    const closingCurves = [
      ` Q ${left} ${top} ${left + radius} ${top}`,
      ` Q ${right} ${top} ${right} ${top + radius}`,
      ` Q ${right} ${bottom} ${right - radius} ${bottom}`,
      ` Q ${left} ${bottom} ${left} ${bottom - radius}`
    ];
    const finalCurve = close ? closingCurves[startCorner] : '';
    return `${start}${this.roundedRectSegments(box, startCorner)}${finalCurve}`;
  }

  private roundedRectStart(box: RouteBox, corner: number): string {
    const { left, top, right, bottom, radius } = box;
    const starts = [
      `M ${left + radius} ${top}`,
      `M ${right} ${top + radius}`,
      `M ${right - radius} ${bottom}`,
      `M ${left} ${bottom - radius}`
    ];
    return starts[corner];
  }

  private roundedRectSegments(box: RouteBox, corner: number): string {
    const { left, top, right, bottom, radius } = box;
    const segments = [
      ` H ${right - radius} Q ${right} ${top} ${right} ${top + radius} V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} H ${left + radius} Q ${left} ${bottom} ${left} ${bottom - radius} V ${top + radius}`,
      ` V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} H ${left + radius} Q ${left} ${bottom} ${left} ${bottom - radius} V ${top + radius} Q ${left} ${top} ${left + radius} ${top} H ${right - radius}`,
      ` H ${left + radius} Q ${left} ${bottom} ${left} ${bottom - radius} V ${top + radius} Q ${left} ${top} ${left + radius} ${top} H ${right - radius} Q ${right} ${top} ${right} ${top + radius}`,
      ` V ${top + radius} Q ${left} ${top} ${left + radius} ${top} H ${right - radius} Q ${right} ${top} ${right} ${top + radius} V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} H ${left + radius}`
    ];
    return segments[corner];
  }

  private createOrthogonalConnector(previous: RouteBox, next: RouteBox): string {
    const horizontalGap = next.left - previous.right;
    if (horizontalGap > 0) {
      const gutterX = previous.right + horizontalGap / 2;
      return ` H ${gutterX} V ${next.top} H ${next.left + next.radius}`;
    }

    const verticalGap = next.top - previous.bottom;
    if (verticalGap > 0) {
      const gutterY = previous.bottom + verticalGap / 2;
      return ` V ${gutterY} H ${next.left + next.radius} V ${next.top}`;
    }

    return ` H ${next.left + next.radius} V ${next.top}`;
  }

  private finishTraveler(): void {
    if (this.frameId) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = undefined;
    }
    this.activeOverlay?.remove();
    this.clearFadeTimer();
    this.activeOverlay = undefined;
    this.activeTargets = [];
    this.routePath = '';
    this.routeLength = 0;
    this.progress = 0;
    this.routeStartCorner = 0;
    this.travelStartTime = 0;
    this.dissipationStartTime = 0;
    this.isDissipating = false;
    this.isAuraTraveling = false;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    window.removeEventListener('scroll', this.requestRouteUpdate, true);
    window.removeEventListener('resize', this.requestRouteUpdate);
  }

  private clearTimer(): void {
    if (this.timerId) {
      window.clearTimeout(this.timerId);
      this.timerId = undefined;
    }
  }

  private clearFadeTimer(): void {
    if (this.fadeId) {
      window.clearTimeout(this.fadeId);
      this.fadeId = undefined;
    }
  }

  private isEligibleTarget(target: HTMLElement): boolean {
    return !target.closest('.dashboard-navigation') && this.isVisible(target);
  }

  private isVisible(target: HTMLElement): boolean {
    const bounds = target.getBoundingClientRect();
    const style = window.getComputedStyle(target);
    const isCompactChartStat = target.dataset['auraTarget'] === 'chart-stat';
    const minWidth = isCompactChartStat ? 40 : 120;
    const minHeight = isCompactChartStat ? 40 : 80;
    return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > minWidth && bounds.height > minHeight && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
  }

  private shuffle<T>(items: T[]): T[] {
    return items.sort(() => Math.random() - 0.5);
  }

  private parseRadius(value: string): number {
    const radius = Number.parseFloat(value);
    return Number.isFinite(radius) ? radius : 0;
  }

  private randomDelay(): number {
    const min = Math.max(0, this.config.minDelayMs);
    const max = Math.max(min, this.config.maxDelayMs);
    return min + Math.round(Math.random() * (max - min));
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
