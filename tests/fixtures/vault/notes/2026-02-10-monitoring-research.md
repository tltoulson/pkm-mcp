---
type: note
title: Monitoring Stack Research
created: '2026-02-10T10:00:00'
modified: '2026-02-15T14:00:00'
subtype: research
aliases:
  - monitoring options
  - observability research
related:
  - '[[projects/2026-01-15-platform-modernization]]'
---
# Monitoring Stack Options

Evaluated Datadog, Grafana+Prometheus, CloudWatch, and New Relic.

Key findings:
- Datadog: best UX, very expensive at scale (~$40k/yr at our cardinality)
- Grafana+Prometheus: open source, excellent community, requires more ops overhead
- CloudWatch: native AWS integration but limited query language
- New Relic: good value but weaker alerting

Recommendation: Grafana + Prometheus. See [[decisions/2026-03-15-monitoring-stack]].
