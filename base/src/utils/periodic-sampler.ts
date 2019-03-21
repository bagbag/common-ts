import { Observable, Subject } from 'rxjs';
import { bufferCount, filter, map } from 'rxjs/operators';
import { average } from './math';
import { timeout } from './timing';

export enum AggregationMode {
  Minimum,
  Maximum,
  Mean,
  Median,
  FirstQuartile,
  ThirdQuartile
}

export type SampleFunction = () => number | Promise<number>;

export class PeriodicSampler {
  private readonly sampleFunction: SampleFunction;
  private readonly subject: Subject<number>;

  private run: boolean;
  private stopped: Promise<void>;

  sampleInterval: number;

  constructor(sampleFunction: SampleFunction, sampleInterval: number = 100) {
    this.sampleFunction = sampleFunction;
    this.sampleInterval = sampleInterval;

    this.run = false;
    this.subject = new Subject();
  }

  start(): void {
    if (this.run) {
      throw new Error('already started');
    }

    this.run = true;
    this.stopped = this.runSampleLoop();
  }

  async stop(): Promise<void> {
    this.run = false;
    await this.stopped;
  }

  watch(threshold: number = 0, samples: number = 1, aggregation: AggregationMode = AggregationMode.Maximum): Observable<number> {
    const observable = this.subject.pipe(
      bufferCount(samples),
      map((measures) => this.aggregate(aggregation, measures)),
      filter((ms) => ms >= threshold)
    );

    return observable;
  }

  private async runSampleLoop(): Promise<void> {
    while (this.run) {
      const delay = await this.sampleFunction();
      this.subject.next(delay);

      await timeout(this.sampleInterval);
    }
  }

  private aggregate(aggregation: AggregationMode, values: number[]): number {
    switch (aggregation) {
      case AggregationMode.Minimum:
        return Math.min(...values);

      case AggregationMode.Maximum:
        return Math.max(...values);

      case AggregationMode.Mean:
        return average(...values);

      case AggregationMode.Median:
        values.sort((a, b) => a - b);
        const median = Math.round(values.length / 2);
        return values[median];

      case AggregationMode.FirstQuartile:
        values.sort((a, b) => a - b);
        const firstQuartile = Math.round(values.length / 4 * 1);
        return values[firstQuartile];

      case AggregationMode.ThirdQuartile:
        values.sort((a, b) => a - b);
        const thirdQuartile = Math.round(values.length / 4 * 3);
        return values[thirdQuartile];

      default:
        throw new Error(`aggregation mode ${aggregation} (${AggregationMode[aggregation]}) not implemented`);
    }
  }
}
