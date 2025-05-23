# WDW Magic Explorer
Walt Disney World Map
WDW Magic Explorer is a fan-made web app for exploring and comparing historical and current map imagery for Walt Disney World in Florida.
You can easily switch between official Disney park maps from different years, Google satellite imagery, and roads overlays. Features include date switching, user location, and quick map view switching for fans and researchers.

***Features
***	•	Browse high-quality Disney World park maps from multiple years
	•	Instantly switch between park maps, Google Satellite, and Google Roads views
	•	See your location on the map (if enabled)
	•	“Quick Switch” for fast toggling between recently viewed dates
	•	Responsive design for desktop and mobile devices
	•	Add to Home Screen support for a full-app experience on iOS and Android

**Live Demo
**
Try it out: https://olivefinch.github.io/WDWMap/

**Screenshots
**
(Add some screenshots here!)

**Getting Started
**
**Prerequisites
**	•	You need a simple web server (like Live Server, Python’s http.server, or a static web host)
	•	OpenLayers is used via CDN (no build step needed)

Installation
**	1.	Clone this repository:
**git clone https://github.com/yourusername/wdw-magic-explorer.git
cd wdw-magic-explorer

**	2.	Add map servers:
**The app requires a servers.json file in the root directory containing available map server codes and labels.
Example format:

[
  { "code": "2024", "label": "2024 Official Map" },
  { "code": "2022", "label": "2022 Official Map" }
  // ...etc
]

**	3.	Start your web server:
** python3 -m http.server

 Then open http://localhost:8000 in your browser.

**App Icons and Manifest
**	•	Place your icons (favicon.ico, icon-192.png, icon-512.png, apple-touch-icon.png) in the root folder.
	•	Edit manifest.webmanifest as needed for your app name and icons.

**Add to Home Screen
**
On iOS/Android, use the browser “Add to Home Screen” option for a full app experience.

**Contributing
**
Contributions, suggestions, and Disney map data are welcome!
Open an issue or submit a pull request.

**Legal**

This is an independent, non-commercial project and is not affiliated with, endorsed by, or connected to The Walt Disney Company.
All map imagery © Disney or their respective owners.
Google Satellite and Roads map data © Google and their data providers.

**Buy Me a Coffee
**
If you like this project, consider buying me a coffee (https://paypal.me/AshJB) – thank you!
