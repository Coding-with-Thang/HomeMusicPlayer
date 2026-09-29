# HomeAudioPlayer Windows companion

The companion indexes folders on a Windows PC and streams them privately to the
mobile app. Node.js 22+ and Tailscale are required.

1. Run `npm install` and `npm start` in this folder.
2. On first start, copy the one-time setup code printed in the terminal. Open
   `http://127.0.0.1:47831`, enter that code, and create an admin password of
   at least 12 characters. Complete this before installing the startup task.
3. Add folders on the authenticated admin page, or select folders later from
   the mobile app after pairing.
4. In an Administrator PowerShell window, run `tailscale serve --bg 47832`.
   Use Tailscale **Serve**, never the public **Funnel** feature.
5. Sign in to the setup page and generate a pairing code.
6. In the mobile app, open Settings > PC streaming and enter the generated
   `https://*.ts.net` URL and pairing code.
7. Select **Choose PC music folders** to browse the PC remotely, choose the
   folders to index, and sync them into the mobile library.

Long-pressing a PC track in the mobile library opens the metadata editor.
Saving writes the updated tags back to the original audio file on the PC.

The API listens only on loopback. Tailscale Serve provides private HTTPS, and
the app authenticates each catalog, artwork, and audio request with a random,
per-device bearer token. When Tailscale supplies a user identity, the token is
also bound to that identity.

Disconnecting in the mobile app revokes its server token before removing local
data. If the PC is offline, the app warns that only local removal is possible.
Use **Paired devices** on the admin page to revoke a lost phone, revoke every
device, or make a phone read-only. Existing installations keep their paired
devices during the config migration, but should set an admin password at the
next companion start.

After first-run setup, run `scripts/install-startup.ps1` from PowerShell to
start the companion at sign-in.

## Security boundary

The admin and API ports must remain bound to `127.0.0.1`. The admin password,
CSRF protection, scoped tokens, revocation, and Tailscale identity binding
protect against unauthorized web and tailnet requests. They cannot isolate the
music library from malware already running as the same Windows user, because
that process already has the user's filesystem access.
