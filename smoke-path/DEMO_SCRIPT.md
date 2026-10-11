# 3-minute demo script

Setup (before recording): open `frontend/index.html` straight from disk (saved sample, no server needed), or
`http://127.0.0.1:8765/index.html?api=/` for live data. Use a 1440x900 window. In the account menu choose
"Clear demo alerts and cases". Note: the saved sample is from 10 Oct 2026, 3 pm; there were no fires in Punjab that day,
so the story uses the sample's real fires in Jharkhand and Odisha. On the day you record, live data may have Punjab fires.

| Time | Click | Say |
|---|---|---|
| 0:00 | Landing page | "NASA satellites see fires. VayuRahshak shows what is burning, how toxic, where the smoke goes, and warns people in its way." |
| 0:15 | **I'm a citizen** > **Continue as demo citizen** | "Two kinds of users. First, a citizen." |
| 0:25 | Under "Where smoke is heading right now" click the first chip (Bisoi) | "She picks her town. We even suggest places the smoke is heading to." |
| 0:35 | My area page | "Air near her: Moderate, 185. The next 48 hours. And: smoke from 4 fires may reach her, the first in about 2 hours." Scroll to the mini map. |
| 1:00 | Account menu > **Switch to Authority (demo)** | "Now the pollution control officer." |
| 1:10 | Dashboard | "256 fires in 24 hours, 51 highly toxic. Dots are sized by toxicity." |
| 1:25 | Search box: type `Gamharia`, click the fire | "A farm fire in Jharkhand. Why we think it is a farm fire: 50% cropland. Toxicity 1.1 km3 of air poisoned per hour, mostly PM2.5." Watch the smoke animate. |
| 1:50 | **Warn the farmer** > **Send warning** | "Ready-made message, English or Hindi. Contacts are demo data; owner lookup is not connected yet." Toast: Warning sent (demo). |
| 2:10 | **Alert people (3 places)** > **Send alert** | "Alert the people on the smoke path, with a preview." Point at status **Warning sent** and the timeline. |
| 2:30 | Account menu > **Switch to Citizen (demo)** | "Back to the citizen." |
| 2:35 | Bell shows 1 (or the Alerts card on My area) > open **Alerts** | "The alert from the authority is here, in her inbox." |
| 2:50 | Click **हि** (top right) | "Hindi for citizens." |
| 3:00 | End | "Lambda, API Gateway, DynamoDB on AWS; Cognito sign-in prepared." |

If the alert does not reach the citizen: the citizen's town must be on that fire's smoke path (Bisoi is for fire `Gamharia`).
