package scorpion.gate

# Default release-gate policy, evaluated by opaService.ts as a Policy-as-Code
# alternative to the hardcoded threshold checks in policyService.ts.
#
# Input shape (see opaService.ts buildScanInput):
# {
#   "critical_count": 0, "high_count": 0, "security_score": 80,
#   "environment": "production", "blocked_falco_rules_matched": []
# }

default allow = false

# Allow when nothing below denies the release.
allow {
    count(deny) == 0
}

deny[msg] {
    input.critical_count > 0
    msg := sprintf("%d critical finding(s) present - zero tolerance policy", [input.critical_count])
}

deny[msg] {
    input.environment == "production"
    input.high_count > 3
    msg := sprintf("%d high-severity findings exceed the production limit of 3", [input.high_count])
}

deny[msg] {
    input.security_score < 50
    msg := sprintf("security score %d is below the minimum of 50", [input.security_score])
}

deny[msg] {
    count(input.blocked_falco_rules_matched) > 0
    msg := sprintf("blocked runtime rule(s) matched: %v", [input.blocked_falco_rules_matched])
}
