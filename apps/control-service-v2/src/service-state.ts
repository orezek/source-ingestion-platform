import {
  controlServiceHealthzResponseV2Schema,
  controlServiceHeartbeatResponseV2Schema,
  controlServiceReadyzResponseV2Schema,
} from '@repo/control-plane-contracts';

type ServiceStateInput = {
  serviceName: string;
  serviceVersion: string;
  subscriptionEnabled: boolean;
};

export class ControlServiceState {
  private readonly serviceName: string;
  private readonly serviceVersion: string;
  private readonly subscriptionEnabled: boolean;
  private mongoReady = false;
  private consumerReady = false;
  private subscriptionName: string | undefined;
  private lastMessageReceivedAt: string | null = null;
  private lastMessageAppliedAt: string | null = null;
  private lastErrorAt: string | null = null;

  public constructor(input: ServiceStateInput) {
    this.serviceName = input.serviceName;
    this.serviceVersion = input.serviceVersion;
    this.subscriptionEnabled = input.subscriptionEnabled;
  }

  public setMongoReady(value: boolean): void {
    this.mongoReady = value;
  }

  public setConsumerReady(value: boolean): void {
    this.consumerReady = value;
  }

  public setSubscriptionName(value: string | undefined): void {
    this.subscriptionName = value;
  }

  public recordMessageReceived(at: string): void {
    this.lastMessageReceivedAt = at;
  }

  public recordMessageApplied(at: string): void {
    this.lastMessageAppliedAt = at;
  }

  public recordError(at: string): void {
    this.lastErrorAt = at;
  }

  public isReady(): boolean {
    return this.mongoReady && (!this.subscriptionEnabled || this.consumerReady);
  }

  public buildHealthz(now: string) {
    return controlServiceHealthzResponseV2Schema.parse({
      ok: true,
      serviceName: this.serviceName,
      serviceVersion: this.serviceVersion,
      now,
    });
  }

  public buildReadyz(now: string) {
    return controlServiceReadyzResponseV2Schema.parse({
      ok: this.isReady(),
      serviceName: this.serviceName,
      serviceVersion: this.serviceVersion,
      now,
      mongoReady: this.mongoReady,
      subscriptionEnabled: this.subscriptionEnabled,
      consumerReady: this.subscriptionEnabled ? this.consumerReady : true,
    });
  }

  public buildHeartbeat(now: string) {
    return controlServiceHeartbeatResponseV2Schema.parse({
      serviceName: this.serviceName,
      serviceVersion: this.serviceVersion,
      now,
      mongoReady: this.mongoReady,
      subscriptionEnabled: this.subscriptionEnabled,
      consumerReady: this.subscriptionEnabled ? this.consumerReady : true,
      subscriptionName: this.subscriptionName,
      lastMessageReceivedAt: this.lastMessageReceivedAt,
      lastMessageAppliedAt: this.lastMessageAppliedAt,
      lastErrorAt: this.lastErrorAt,
    });
  }
}
