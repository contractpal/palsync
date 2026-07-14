# Console chrome exceptions

Console screenshots can include CloudPiston platform chrome outside the pal's `#cp-root`. Findings such as `tableHeaders` on the chrome action table or `horizontalOverflow` on the function-call timer are not fixable in pal code. Claim an exception only when the finding samples say `OUTSIDE #cp-root` or its scope is not `#cp-root`, and quote that sample string in the checkpoint. The same finding inside pal content remains a failure.
