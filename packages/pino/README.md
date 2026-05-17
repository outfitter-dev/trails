# @ontrails/pino

Pino adapter package for `@ontrails/observe`.

This package is the publishable home for Trails log forwarding into
Pino-shaped loggers. It intentionally does not depend on `pino`; the sink uses
a structural logger interface so applications can pass their existing logger.

The structural sink implementation lands in the follow-up Pino issue. Until
then, this package establishes the workspace, package exports, and publish
checks for `@ontrails/pino`.
