import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, inject } from '@angular/core';

interface RouteBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
}

@Injectable({ providedIn: 'root' })
export class AuraEnergyService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly travelDurationMs = 5000;
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
  private progress = 0;
  private isAuraTraveling = false;
  private isDestroyed = false;

  start(): void {
    if (this.prefersReducedMotion() || this.isDestroyed || this.isAuraTraveling || this.timerId) {
      return;
    }

    this.zone.runOutsideAngular(() => this.scheduleNextPulse(this.randomDelay()));
  }

  setPathwayPreview(enabled: boolean): void {
    if (this.isDestroyed) {
      return;
    }

    this.clearTimer();
    this.clearFadeTimer();

    if (!enabled) {
      this.finishTraveler();
      this.scheduleNextPulse(this.randomDelay());
      return;
    }

    if (!this.isAuraTraveling) {
      this.startTraveler();
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    this.clearTimer();
    this.clearFadeTimer();
    this.finishTraveler();
  }

  private scheduleNextPulse(delay: number): void {
    if (this.isDestroyed || this.isAuraTraveling || this.timerId) {
      return;
    }

    this.timerId = window.setTimeout(() => {
      this.timerId = undefined;
      if (!this.isDestroyed && !this.prefersReducedMotion() && !this.isAuraTraveling) {
        this.startTraveler();
      }
    }, delay);
  }

  private startTraveler(): void {
    if (this.isDestroyed || this.isAuraTraveling) {
      return;
    }

    this.auraContainer = this.document.querySelector<HTMLElement>('.tradezella-dashboard') || undefined;
    if (!this.auraContainer) {
      this.scheduleNextPulse(this.randomDelay());
      return;
    }

    this.activeTargets = this.selectRandomTargets();
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
    const count = Math.min(targets.length, 2 + Math.floor(Math.random() * 3));

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
    overlay.innerHTML = `
      <svg class="aura-energy-svg" focusable="false" preserveAspectRatio="none">
        <defs>
          <linearGradient id="aura-energy-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#7C3AED" stop-opacity="0" />
            <stop offset="50%" stop-color="#A78BFA" stop-opacity="0.35" />
            <stop offset="82%" stop-color="#E9D5FF" stop-opacity="0.9" />
            <stop offset="100%" stop-color="#FFFFFF" />
          </linearGradient>
          <filter id="aura-energy-bloom" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.4" result="wide-blur" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.7" result="soft-blur" />
            <feMerge><feMergeNode in="wide-blur" /><feMergeNode in="soft-blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path id="aura-route" class="aura-energy-line" pathLength="1000" />
        <circle class="aura-energy-head" r="6" />
      </svg>`;
    return overlay;
  }

  private animateTraveler = (timestamp: number): void => {
    if (!this.isAuraTraveling || !this.activeOverlay || !this.routeLength) {
      return;
    }

    if (!this.travelStartTime) {
      this.travelStartTime = timestamp;
    }
    this.progress = Math.min(1, (timestamp - this.travelStartTime) / this.travelDurationMs);
    this.renderTraveler();

    if (this.progress >= 1) {
      this.activeOverlay.classList.add('aura-energy-fading');
      this.fadeId = window.setTimeout(() => {
        this.fadeId = undefined;
        this.finishTraveler();
      }, 180);
      return;
    }

    this.frameId = window.requestAnimationFrame(this.animateTraveler);
  };

  private travelStartTime = 0;

  private renderTraveler(): void {
    const path = this.activeOverlay?.querySelector<SVGPathElement>('#aura-route');
    const head = this.activeOverlay?.querySelector<SVGCircleElement>('.aura-energy-head');
    if (!path || !head) {
      return;
    }

    const distance = this.routeLength * this.progress;
    const point = path.getPointAtLength(distance);
    path.style.strokeDasharray = `${Math.max(26, this.routeLength * 0.035)} ${this.routeLength}`;
    path.style.strokeDashoffset = `${-distance}`;
    head.setAttribute('cx', `${point.x}`);
    head.setAttribute('cy', `${point.y}`);
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

    let path = this.roundedRectPath(routeData[0]);
    for (let index = 1; index < routeData.length; index += 1) {
      const connector = this.createOrthogonalConnector(routeData[index - 1], routeData[index]);
      if (!connector) {
        break;
      }
      path += connector + this.roundedRectPath(routeData[index], true);
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

  private roundedRectPath(box: RouteBox, continuation = false): string {
    const { left, top, right, bottom, radius } = box;
    const start = continuation ? '' : `M ${left + radius} ${top}`;
    return `${start} H ${right - radius} Q ${right} ${top} ${right} ${top + radius} V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} H ${left + radius} Q ${left} ${bottom} ${left} ${bottom - radius} V ${top + radius} Q ${left} ${top} ${left + radius} ${top} Z`;
  }

  private createOrthogonalConnector(previous: RouteBox, next: RouteBox): string | undefined {
    const horizontalGap = next.left - previous.right;
    if (horizontalGap > 0) {
      const gutterX = previous.right + horizontalGap / 2;
      const sharedY = Math.max(previous.top, Math.min(next.top, previous.bottom));
      return ` M ${previous.right} ${sharedY} H ${gutterX} V ${next.top} H ${next.left + next.radius}`;
    }

    const verticalGap = next.top - previous.bottom;
    if (verticalGap > 0) {
      const gutterY = previous.bottom + verticalGap / 2;
      const sharedX = Math.max(previous.left, Math.min(next.left, previous.right));
      return ` M ${sharedX} ${previous.bottom} V ${gutterY} H ${next.left + next.radius} V ${next.top}`;
    }

    return undefined;
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
    this.travelStartTime = 0;
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
    return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 120 && bounds.height > 80 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
  }

  private shuffle<T>(items: T[]): T[] {
    return items.sort(() => Math.random() - 0.5);
  }

  private parseRadius(value: string): number {
    const radius = Number.parseFloat(value);
    return Number.isFinite(radius) ? radius : 0;
  }

  private randomDelay(): number {
    return 5000 + Math.round(Math.random() * 10000);
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
