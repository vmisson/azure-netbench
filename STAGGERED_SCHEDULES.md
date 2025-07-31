# Workflows with Staggered Schedules

If you prefer to stagger workflow execution to avoid Azure resource conflicts or distribute load, here are suggested schedules:

## Staggered Times (UTC)

```yaml
# Asia Region - 01:00 UTC
schedule:
  - cron: '0 1 * * *'

# Europe Region - 02:00 UTC  
schedule:
  - cron: '0 2 * * *'

# France Region - 03:00 UTC
schedule:
  - cron: '0 3 * * *'

# Sweden Region - 04:00 UTC
schedule:
  - cron: '0 4 * * *'

# US Region - 05:00 UTC
schedule:
  - cron: '0 5 * * *'
```

## Alternative: Different Days

```yaml
# Asia Region - Monday
schedule:
  - cron: '0 2 * * 1'

# Europe Region - Tuesday
schedule:
  - cron: '0 2 * * 2'

# France Region - Wednesday
schedule:
  - cron: '0 2 * * 3'

# Sweden Region - Thursday
schedule:
  - cron: '0 2 * * 4'

# US Region - Friday
schedule:
  - cron: '0 2 * * 5'
```

## To Apply These Changes

1. Modify the `schedule` section in each workflow file
2. Commit and push the changes
3. New schedules will be automatically applied
