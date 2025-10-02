type CounterImpl = {
  name: string;
  inc: (amount?: number) => void;
  value: () => number;
};

type GaugeImpl = {
  name: string;
  set: (value: number) => void;
  value: () => number;
};

type HistogramImpl = {
  name: string;
  observe: (value: number) => void;
  percentile: (percentile: number) => number | null;
  reset: () => void;
};

class InMemoryCounter implements CounterImpl {
  #value = 0;
  constructor(public readonly name: string) {}

  inc(amount = 1): void {
    if (!Number.isFinite(amount)) {
      throw new Error(`Invalid counter increment for ${this.name}: ${amount}`);
    }
    this.#value += amount;
  }

  value(): number {
    return this.#value;
  }
}

class InMemoryGauge implements GaugeImpl {
  #value = 0;
  constructor(public readonly name: string) {}

  set(value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid gauge value for ${this.name}: ${value}`);
    }
    this.#value = value;
  }

  value(): number {
    return this.#value;
  }
}

class InMemoryHistogram implements HistogramImpl {
  #values: number[] = [];
  constructor(public readonly name: string) {}

  observe(value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid histogram value for ${this.name}: ${value}`);
    }
    this.#values.push(value);
  }

  percentile(percentile: number): number | null {
    if (this.#values.length === 0) {
      return null;
    }

    const sorted = [...this.#values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
    return sorted[index];
  }

  reset(): void {
    this.#values = [];
  }
}

type MetricKind = "counter" | "gauge" | "histogram";

type MetricRegistryEntry = CounterImpl | GaugeImpl | HistogramImpl;

const registry = new Map<string, MetricRegistryEntry>();

function getOrCreateMetric<T extends MetricRegistryEntry>(name: string, kind: MetricKind, factory: () => T): T {
  const existing = registry.get(name);
  if (existing) {
    return existing as T;
  }

  const created = factory();
  registry.set(name, created);
  return created;
}

export function counter(name: string): CounterImpl {
  return getOrCreateMetric(name, "counter", () => new InMemoryCounter(name));
}

export function gauge(name: string): GaugeImpl {
  return getOrCreateMetric(name, "gauge", () => new InMemoryGauge(name));
}

export function histogram(name: string): HistogramImpl {
  return getOrCreateMetric(name, "histogram", () => new InMemoryHistogram(name));
}

export function snapshotMetrics(): Record<string, number | { percentile: (p: number) => number | null }> {
  const snapshot: Record<string, number | { percentile: (p: number) => number | null }> = {};
  for (const [name, metric] of registry.entries()) {
    if (metric instanceof InMemoryCounter || metric instanceof InMemoryGauge) {
      snapshot[name] = metric.value();
    } else if (metric instanceof InMemoryHistogram) {
      snapshot[name] = {
        percentile: (p: number) => metric.percentile(p)
      };
    }
  }
  return snapshot;
}

export function resetMetrics(): void {
  for (const metric of registry.values()) {
    if (metric instanceof InMemoryHistogram) {
      metric.reset();
    } else if (metric instanceof InMemoryCounter || metric instanceof InMemoryGauge) {
      if ("set" in metric) {
        metric.set(0);
      } else if ("inc" in metric) {
        // Set counters back to zero by recreating them.
        registry.delete(metric.name);
        registry.set(metric.name, new InMemoryCounter(metric.name));
      }
    }
  }
}
