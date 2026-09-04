# customer-export

Claims to be a read-only weekly customer count report for the sales dashboard, owned by sales analytics. This app is an intentionally non-compliant reference fixture: it embeds hard-coded credentials, evals code, writes outside its workspace, and calls undeclared external hosts while its manifest declares none of it. It exists so Waypoint's promotion gate can be tested against a submission that must hard-block on every finding class at once.
