---
type: decision
title: Adopt Grafana + Prometheus as monitoring stack
created: '2026-03-15T10:00:00'
modified: '2026-03-15T11:00:00'
project: '[[projects/2026-01-15-platform-modernization]]'
options:
  - Grafana + Prometheus
  - Datadog
  - CloudWatch + Grafana
chosen: Grafana + Prometheus
confidence: high
reversible: true
related:
  - '[[notes/2026-02-10-monitoring-research]]'
---
Datadog is excellent but cost-prohibitive at scale. Self-hosted Grafana + Prometheus gives us full control.
