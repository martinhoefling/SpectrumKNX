=============================================================================
 Spectrum KNX for Windows
 A professional KNX bus monitor and analyzer
 https://github.com/martinhoefling/SpectrumKNX
=============================================================================


GETTING STARTED
---------------

1. Unzip this folder anywhere you like (e.g. C:\Program Files\SpectrumKNX
   or your Desktop).

2. Double-click  spectrum-knx.exe

   - A console window opens and shows the log output. Keep it open;
     closing it stops Spectrum KNX.
   - Your browser opens the web interface automatically
     (default: http://localhost:8000).
   - On first start, Windows Firewall asks for network permission.
     Allow it — it is required to discover KNX/IP gateways and to
     receive KNX routing (multicast) traffic.

3. On first use the web interface asks for your ETS project file
   (.knxproj) so group addresses get readable names. Upload it in the
   wizard (enter the project password if it has one).

To stop Spectrum KNX, press Ctrl+C in the console window or close it.


CONFIGURATION (.env FILE)
-------------------------

On first start, a configuration file named

    .env

is created NEXT TO spectrum-knx.exe (in this folder). Open it with any
text editor (e.g. Notepad). Every setting is a KEY=VALUE line; lines
starting with # are comments/disabled. Restart Spectrum KNX after
changing it.

The most important settings:

  Web interface
    BIND_HOST=127.0.0.1     only this PC can open the UI (default)
    BIND_HOST=0.0.0.0       other devices on your network can open it
    BIND_PORT=8000          change if port 8000 is already in use

  KNX connection
    KNX_CONNECTION_TYPE=automatic
        Scans the network for a KNX/IP gateway. Other values:
        tunneling, tunneling_tcp, tunneling_tcp_secure, routing,
        routing_secure

    For tunneling (recommended if you have a KNX/IP interface):
        KNX_CONNECTION_TYPE=tunneling
        KNX_GATEWAY_IP=192.168.1.10
        #KNX_GATEWAY_PORT=3671

    For routing (KNX/IP router, multicast):
        KNX_CONNECTION_TYPE=routing
        #KNX_MULTICAST_GROUP=224.0.23.12
        #KNX_MULTICAST_PORT=3671
        #KNX_INDIVIDUAL_ADDRESS=15.15.250

    For KNX IP Secure, export a .knxkeys file from ETS:
        KNX_CONNECTION_TYPE=tunneling_tcp_secure
        KNX_KNXKEYS_FILE=C:/SpectrumKNX/keys.knxkeys
        KNX_KNXKEYS_PASSWORD=your_keys_password

  Logging
    LOG_LEVEL=info          use debug for troubleshooting

The full list of settings is documented in DEPLOYMENT.md in the
repository: https://github.com/martinhoefling/SpectrumKNX


WHERE YOUR DATA IS STORED
-------------------------

  Telegram database (SQLite)
      %LOCALAPPDATA%\SpectrumKNX\spectrum-knx.db
      (usually C:\Users\<you>\AppData\Local\SpectrumKNX\)

  Uploaded ETS project file
      %LOCALAPPDATA%\SpectrumKNX\knx_project.knxproj

  Configuration
      .env file next to spectrum-knx.exe (this folder)

You can override the storage locations in the .env file
(DATABASE_URL and KNX_PROJECT_PATH — use forward slashes in paths).


UPGRADING
---------

1. Stop Spectrum KNX.
2. If you changed the .env file, keep a copy of it.
3. Unzip the new version (replacing or next to the old folder) and copy
   your .env back next to the new spectrum-knx.exe.

Your telegram history and the uploaded project file live in
%LOCALAPPDATA%\SpectrumKNX and are not touched by an upgrade.


UNINSTALLING
------------

1. Delete this folder.
2. To also remove your recorded telegram history and uploaded project
   file, delete  %LOCALAPPDATA%\SpectrumKNX


TROUBLESHOOTING
---------------

- The browser shows "connection refused":
  Check the console window — the URL and any errors are printed there.
  If port 8000 is taken by another program, set a different BIND_PORT
  in .env and restart.

- No KNX gateway found / no telegrams:
  Make sure the firewall permission was granted (Windows Settings >
  Firewall > Allowed apps, look for spectrum-knx). With multiple
  network adapters (VPN, virtualization), set KNX_LOCAL_IP in .env to
  the IP of the adapter that reaches your KNX installation. If
  automatic discovery fails, configure the gateway explicitly with
  KNX_CONNECTION_TYPE=tunneling and KNX_GATEWAY_IP.

- More detail in the logs:
  Set LOG_LEVEL=debug in .env and restart.

- Bug reports and questions:
  https://github.com/martinhoefling/SpectrumKNX/issues
