# Setup

## Your first search

Add your car under **Your garage**, including the year, make, model, and any trim or engine notes. Upload JPG, PNG, or WebP photos, up to 4 MB each. Add wanted parts to the checklist; change their status and record the seller, purchase date, and price as your build progresses.

Choose **Create monitor** on a car, select a part preset, and confirm its provider and filters. The default ZIP comes from your garage settings. A preset is a draft, not an active search, until you save it. File-import monitors wait for imports. Feed, eBay, and authorized Car-Part monitors run on their configured interval; **Scan now** starts a check immediately.

## Connection checks

**Discord webhook:** use a complete channel webhook URL, not a server invite or a bot token. Send a test message from Settings. Blank credential inputs preserve saved values. Disconnect removes credentials saved by the UI; environment-defined connections must be removed from the environment.

**eBay:** use production credentials, not sandbox keys. Test access before creating an eBay monitor. Tokens obtained through client credentials are cached until shortly before expiration. A manually entered access token must be replaced when it expires.

**Command bot:** invite the application into the configured guild, set allowed user IDs, and click Connect & register commands. This updates only `/scout` for that application's guild, preserving its other commands. An invitation alone does not run the bot. The app must remain running for commands and scans to work.

**Car-Part:** set the permission checkbox only after obtaining provider permission. Verify model/part identifiers and interchange wording. A layout change or selection page produces a visible error instead of discarding inventory.

## Photos and seller actions

Seller photos take priority. Reference cutouts are used only when a listing has no photo and a suitable reference exists. They are labeled and do not establish condition, identity, or compatibility. Add your own HTTPS reference URL to a monitor when needed. Original seller photos are not retouched.

Listing details show every available image with arrow controls and thumbnails. eBay's full detail fetch can supply additional photos and attributes. Seller checkout uses an isolated desktop window without access to the garage's API token or local Node APIs. Some sellers may require a regular browser for their login or checkout. You complete every purchase or bid yourself and then update the garage checklist.

## Excel period

The export period selects listings first discovered by that monitor, with current eligible filters applied. The end time is exclusive. Price history covers changes within the same period for those selected records. Times in the workbook are UTC; the picker uses your local time. This is a discovery report, not a record of every repeated scan observation.

## Phone notifications

The phone toggle adds a mention of your configured user ID to Part Scout's alerts. It does not enable Discord or phone OS notifications remotely. Discord server/channel mute settings, notification preferences, and foreground activity can affect delivery. Use an unmuted alerts channel and check the phone's notification permission.

## Troubleshooting

| Problem                                | Check                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| No results                             | Confirm source access, model/part query, year range, and filters. Activity shows source errors.       |
| An alert stays queued                  | Check the connection and alert mode; digest jobs wait until their window expires.                     |
| No phone notification                  | Check the user ID, mention toggle, Discord channel settings, and phone permission.                    |
| No seller photos                       | The source may not supply any. Try eBay's full detail fetch; reference photos remain clearly labeled. |
| Bot offline                            | Check token, application/guild IDs, invite, allowed users, and that the app remains running.          |
| A scan is busy                         | Only one scan runs at a time. Its result appears in Activity.                                         |
| Closing the window does not stop scans | Quit from the tray or disable background monitoring.                                                  |
| Browser asks for an admin token        | Use your server's admin token. The desktop app handles this internally.                               |
