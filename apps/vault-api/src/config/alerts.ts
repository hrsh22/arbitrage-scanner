/**
 * Alert Configuration
 *
 * Defines alert thresholds, routing rules, and notification channels
 * for the vault health monitoring system.
 */

import type { HealthCheckResult } from "../services/vaultHealthMonitor.js";

// ===== Alert Thresholds =====

export const ALERT_THRESHOLDS = {
  /** Epoch settlement lag: alert if settlement is more than 1 hour past epoch end */
  EPOCH_SETTLEMENT_LAG_SECONDS: 3600,

  /** NAV staleness: alert if NAV is more than 6 hours old */
  NAV_STALENESS_SECONDS: 21600, // 6 hours

  /** Claim backlog: alert if more than 100 pending claims */
  CLAIM_BACKLOG_COUNT: 100,

  /** Failed settlement transactions: alert if more than 5 in 24 hours */
  FAILED_SETTLEMENTS_24H: 5,

  /** Worker heartbeat: alert if no heartbeat in more than 10 minutes */
  WORKER_HEARTBEAT_SECONDS: 600,

  /** Queue processing lag: alert if pending requests older than 30 minutes */
  QUEUE_PROCESSING_LAG_SECONDS: 1800,

  /** Position resolution lag: alert if unresolved positions older than 48 hours after market close */
  POSITION_RESOLUTION_LAG_SECONDS: 172800, // 48 hours
} as const;

// ===== Snapshot-Tranche Alert Thresholds =====

export const SNAPSHOT_TRANCHE_THRESHOLDS = {
  /** Unresolved position timeout: alert if frozen positions unresolved for >25 days */
  UNRESOLVED_POSITION_TIMEOUT_DAYS: 25,
  /** Payout backlog: alert if >100 pending payouts (distributed but unclaimed) */
  PAYOUT_BACKLOG_COUNT: 100,
  /** Frozen snapshot staleness: alert if positions frozen >7 days without realization */
  FROZEN_SNAPSHOT_STALE_DAYS: 7,
  /** Realization processing lag: alert if realizations pending >4 hours */
  REALIZATION_PROCESSING_LAG_HOURS: 4,
} as const;

// ===== Severity Levels =====

export type Severity = "info" | "warning" | "critical";

export interface SeverityConfig {
  level: Severity;
  color: string;
  pagerDutySeverity: "info" | "warning" | "error" | "critical";
  slackEmoji: string;
  description: string;
}

export const SEVERITY_CONFIGS: Record<Severity, SeverityConfig> = {
  info: {
    level: "info",
    color: "#36a64f", // Green
    pagerDutySeverity: "info",
    slackEmoji: ":white_check_mark:",
    description: "Healthy state - no action required",
  },
  warning: {
    level: "warning",
    color: "#ff9900", // Orange
    pagerDutySeverity: "warning",
    slackEmoji: ":warning:",
    description: "Degraded state - investigate when convenient",
  },
  critical: {
    level: "critical",
    color: "#ff0000", // Red
    pagerDutySeverity: "critical",
    slackEmoji: ":rotating_light:",
    description: "Critical state - immediate action required",
  },
};

// ===== Alert Routing Rules =====

export interface AlertRoute {
  /** Check names this route applies to (empty = all) */
  checks: string[];
  /** Minimum severity to trigger */
  minSeverity: Severity;
  /** Channels to notify */
  channels: ("pagerduty" | "slack" | "email")[];
  /** Whether to suppress duplicates within window */
  deduplicate: boolean;
  /** Deduplication window in minutes */
  dedupWindowMinutes: number;
  /** Whether this route is active */
  enabled: boolean;
}

export const DEFAULT_ALERT_ROUTES: AlertRoute[] = [
  // Critical alerts: immediate PagerDuty + Slack
  {
    checks: [],
    minSeverity: "critical",
    channels: ["pagerduty", "slack"],
    deduplicate: true,
    dedupWindowMinutes: 5,
    enabled: true,
  },
  // Warning alerts: Slack only, 15 min dedup
  {
    checks: [],
    minSeverity: "warning",
    channels: ["slack"],
    deduplicate: true,
    dedupWindowMinutes: 15,
    enabled: true,
  },
  // NAV staleness: special handling - always critical
  {
    checks: ["nav_staleness"],
    minSeverity: "warning",
    channels: ["pagerduty", "slack"],
    deduplicate: true,
    dedupWindowMinutes: 10,
    enabled: true,
  },
  // Epoch settlement lag: page immediately
  {
    checks: ["epoch_settlement_lag"],
    minSeverity: "warning",
    channels: ["pagerduty", "slack"],
    deduplicate: true,
    dedupWindowMinutes: 30,
    enabled: true,
  },
  // Snapshot-tranche: unresolved positions timeout - critical
  {
    checks: ["unresolved_positions_timeout"],
    minSeverity: "warning",
    channels: ["pagerduty", "slack"],
    deduplicate: true,
    dedupWindowMinutes: 60,
    enabled: true,
  },
  // Snapshot-tranche: payout backlog - warning
  {
    checks: ["payout_backlog"],
    minSeverity: "warning",
    channels: ["slack"],
    deduplicate: true,
    dedupWindowMinutes: 30,
    enabled: true,
  },
  // Snapshot-tranche: frozen snapshot stale - warning
  {
    checks: ["frozen_snapshot_stale"],
    minSeverity: "warning",
    channels: ["slack"],
    deduplicate: true,
    dedupWindowMinutes: 60,
    enabled: true,
  },
];

// ===== Channel Configurations =====

export interface PagerDutyConfig {
  enabled: boolean;
  routingKey: string;
  serviceKey?: string;
  /** Default severity mapping */
  severityMap: Record<Severity, "info" | "warning" | "error" | "critical">;
}

export interface SlackConfig {
  enabled: boolean;
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

export interface EmailConfig {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  fromAddress: string;
  toAddresses: string[];
  /** Only send for critical alerts */
  criticalOnly: boolean;
}

export interface AlertChannels {
  pagerduty: PagerDutyConfig;
  slack: SlackConfig;
  email: EmailConfig;
}

export const DEFAULT_CHANNEL_CONFIG: AlertChannels = {
  pagerduty: {
    enabled: process.env.PAGERDUTY_ENABLED === "true",
    routingKey: process.env.PAGERDUTY_ROUTING_KEY ?? "",
    severityMap: {
      info: "info",
      warning: "warning",
      critical: "critical",
    },
  },
  slack: {
    enabled: process.env.SLACK_WEBHOOK_URL !== undefined,
    webhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
    channel: process.env.SLACK_CHANNEL ?? "#vault-alerts",
    username: "Vault Health Monitor",
    iconEmoji: ":vault:",
  },
  email: {
    enabled: process.env.EMAIL_ENABLED === "true",
    smtpHost: process.env.SMTP_HOST ?? "",
    smtpPort: parseInt(process.env.SMTP_PORT ?? "587", 10),
    username: process.env.SMTP_USERNAME ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    fromAddress: process.env.ALERT_FROM_EMAIL ?? "alerts@vault.polymarket.io",
    toAddresses: (process.env.ALERT_TO_EMAILS ?? "").split(",").filter(Boolean),
    criticalOnly: true,
  },
};

// ===== Runbook URLs =====

export const RUNBOOK_URLS: Record<string, string> = {
  epoch_settlement_lag:
    "https://github.com/polymarket-mvp/runbooks/blob/main/epoch-settlement-lag.md",
  nav_staleness: "https://github.com/polymarket-mvp/runbooks/blob/main/nav-staleness.md",
  claim_backlog: "https://github.com/polymarket-mvp/runbooks/blob/main/claim-backlog.md",
  failed_settlements: "https://github.com/polymarket-mvp/runbooks/blob/main/failed-settlements.md",
  worker_heartbeat: "https://github.com/polymarket-mvp/runbooks/blob/main/worker-heartbeat.md",
  // Snapshot-tranche runbooks
  unresolved_positions_timeout:
    "https://github.com/polymarket-mvp/runbooks/blob/main/snapshot-tranche/unresolved-positions-timeout.md",
  payout_backlog:
    "https://github.com/polymarket-mvp/runbooks/blob/main/snapshot-tranche/payout-backlog.md",
  frozen_snapshot_stale:
    "https://github.com/polymarket-mvp/runbooks/blob/main/snapshot-tranche/frozen-snapshot-stale.md",
  realization_processing_lag:
    "https://github.com/polymarket-mvp/runbooks/blob/main/snapshot-tranche/realization-processing-lag.md",
  default: "https://github.com/polymarket-mvp/runbooks/blob/main/README.md",
};

// ===== Alert Message Templates =====

export interface AlertTemplate {
  subject: string;
  body: string;
  action: string;
}

export const ALERT_TEMPLATES: Record<string, (result: HealthCheckResult) => AlertTemplate> = {
  epoch_settlement_lag: (result) => ({
    subject: `[CRITICAL] Epoch Settlement Delayed`,
    body: `Epoch settlement is ${result.details?.lagSeconds ?? "unknown"} seconds overdue.\n\n${result.message}`,
    action:
      "1. Check settlement transaction status\n2. Verify NAV is fresh\n3. Manually trigger settlement if needed",
  }),
  nav_staleness: (result) => ({
    subject: `[CRITICAL] NAV Stale`,
    body: `NAV has not been updated for ${result.details?.hoursStale ?? "unknown"} hours.\n\n${result.message}`,
    action:
      "1. Check worker process is running\n2. Verify RPC connectivity\n3. Manually trigger NAV update",
  }),
  claim_backlog: (result) => ({
    subject: `[WARNING] Claim Backlog`,
    body: `There are ${result.details?.totalBacklog ?? "unknown"} pending claims.\n\n${result.message}`,
    action:
      "1. Check claim processing job\n2. Verify gas availability\n3. Process claims manually if needed",
  }),
  failed_settlements: (result) => ({
    subject: `[CRITICAL] Settlement Failures`,
    body: `${result.details?.failedCount24h ?? "unknown"} settlement failures in last 24 hours.\n\n${result.message}`,
    action:
      "1. Check recent transaction logs\n2. Verify contract state\n3. Review gas prices and nonce issues",
  }),
  worker_heartbeat: (result) => ({
    subject: `[CRITICAL] Worker Down`,
    body: `Worker has not sent heartbeat for ${result.details?.minutesStale ?? "unknown"} minutes.\n\n${result.message}`,
    action: "1. Check worker process status\n2. Review worker logs\n3. Restart worker if needed",
  }),
  // Snapshot-tranche templates
  unresolved_positions_timeout: (result) => ({
    subject: `[${result.severity.toUpperCase()}] Unresolved Positions Timeout`,
    body: `${result.details?.totalFrozen ?? "unknown"} frozen position(s) unresolved for ${result.details?.oldestFrozenDays ?? "unknown"} days.\n\n${result.message}`,
    action:
      "1. Check position resolution status\n2. Force-close positions if market resolved\n3. Update realization events",
  }),
  payout_backlog: (result) => ({
    subject: `[WARNING] Payout Backlog`,
    body: `${result.details?.totalBacklog ?? "unknown"} pending payouts awaiting claim.\n\n${result.message}`,
    action:
      "1. Notify users of available claims\n2. Check claim processing pipeline\n3. Verify gas availability for claim transactions",
  }),
  frozen_snapshot_stale: (result) => ({
    subject: `[WARNING] Frozen Snapshot Stale`,
    body: `Snapshot ${result.details?.epochId ?? "unknown"} has ${result.details?.frozenPositionCount ?? "unknown"} positions frozen for ${result.details?.daysSinceFrozen ?? "unknown"} days without realizations.\n\n${result.message}`,
    action:
      "1. Check market resolution status\n2. Process realization events\n3. Review force-close policy for stale positions",
  }),
  default: (result) => ({
    subject: `[${result.severity.toUpperCase()}] ${result.name}`,
    body: result.message,
    action: "Check runbook for details",
  }),
};

// ===== Alert Manager Class =====

export class AlertManager {
  private routes: AlertRoute[];
  private channels: AlertChannels;
  private dedupCache: Map<string, { timestamp: number; count: number }> = new Map();

  constructor(
    routes: AlertRoute[] = DEFAULT_ALERT_ROUTES,
    channels: AlertChannels = DEFAULT_CHANNEL_CONFIG,
  ) {
    this.routes = routes;
    this.channels = channels;
  }

  /**
   * Process a health check result and route alerts accordingly.
   */
  async processAlert(result: HealthCheckResult): Promise<void> {
    if (result.severity === "info") {
      return; // Don't alert on healthy status
    }

    for (const route of this.routes) {
      if (!route.enabled) continue;
      if (route.checks.length > 0 && !route.checks.includes(result.name)) continue;
      if (!this.severityMeetsThreshold(result.severity, route.minSeverity)) continue;

      // Check deduplication
      if (route.deduplicate) {
        const cacheKey = `${result.name}:${result.severity}`;
        const cached = this.dedupCache.get(cacheKey);
        const now = Date.now();

        if (cached && now - cached.timestamp < route.dedupWindowMinutes * 60 * 1000) {
          cached.count++;
          continue; // Skip this alert
        }

        this.dedupCache.set(cacheKey, { timestamp: now, count: 1 });
      }

      // Route to channels
      for (const channel of route.channels) {
        await this.sendToChannel(channel, result);
      }
    }
  }

  private severityMeetsThreshold(actual: Severity, required: Severity): boolean {
    const levels: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
    return levels[actual] >= levels[required];
  }

  private async sendToChannel(
    channel: "pagerduty" | "slack" | "email",
    result: HealthCheckResult,
  ): Promise<void> {
    switch (channel) {
      case "pagerduty":
        if (this.channels.pagerduty.enabled) {
          await this.sendPagerDuty(result);
        }
        break;
      case "slack":
        if (this.channels.slack.enabled) {
          await this.sendSlack(result);
        }
        break;
      case "email":
        if (this.channels.email.enabled) {
          if (!this.channels.email.criticalOnly || result.severity === "critical") {
            await this.sendEmail(result);
          }
        }
        break;
    }
  }

  private async sendPagerDuty(result: HealthCheckResult): Promise<void> {
    const payload = {
      payload: {
        summary: `[${result.severity.toUpperCase()}] ${result.message}`,
        severity: SEVERITY_CONFIGS[result.severity].pagerDutySeverity,
        source: "vault-health-monitor",
        component: result.name,
        custom_details: result.details,
      },
      routing_key: this.channels.pagerduty.routingKey,
      event_action: result.severity === "info" ? "resolve" : "trigger",
    };

    const response = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`PagerDuty alert failed: ${response.statusText}`);
    }
  }

  private async sendSlack(result: HealthCheckResult): Promise<void> {
    const config = SEVERITY_CONFIGS[result.severity];
    const template = ALERT_TEMPLATES[result.name] ?? ALERT_TEMPLATES.default;
    if (!template) {
      console.error(`No alert template found for ${result.name}`);
      return;
    }
    const { subject, body, action } = template(result);

    const payload = {
      username: this.channels.slack.username,
      icon_emoji: config.slackEmoji,
      channel: this.channels.slack.channel,
      attachments: [
        {
          color: config.color,
          title: subject,
          text: body,
          fields: [
            {
              title: "Severity",
              value: result.severity,
              short: true,
            },
            {
              title: "Check",
              value: result.name,
              short: true,
            },
            {
              title: "Action Required",
              value: action,
              short: false,
            },
          ],
          footer: "Vault Health Monitor",
          ts: Math.floor(result.timestamp.getTime() / 1000),
        },
      ],
    };

    const response = await fetch(this.channels.slack.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Slack alert failed: ${response.statusText}`);
    }
  }

  private async sendEmail(_result: HealthCheckResult): Promise<void> {
    // Email implementation would use nodemailer or similar
    // Skipping for brevity - in production, implement with proper SMTP client
    console.log("Email alert would be sent (not implemented in this version)");
  }
}

// ===== Singleton Export =====

let alertManagerInstance: AlertManager | null = null;

export function getAlertManager(): AlertManager {
  if (!alertManagerInstance) {
    alertManagerInstance = new AlertManager();
  }
  return alertManagerInstance;
}
