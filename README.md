# MyTV Art for Samsung TV

MyTV Art turns a Samsung TV into a calm, subscription-free ambient display.

It currently includes:

- Daily Bing photography
- Offline wallpaper caching
- Original motivational quote artwork
- Smooth full-screen transitions
- An artwork-only default view
- On-demand details and copyright information

## Using the app

The normal display contains only the current artwork. Press **Up** on the remote to open details, change sources, view copyright information, or learn more about the project.

| Remote button | Action |
| --- | --- |
| Left / Right | Previous or next artwork |
| OK / Play-Pause | Pause or resume |
| Up | Open details |
| Down / Back | Close details |
| Back while artwork-only | Open the No/Yes exit confirmation |

While details are open:

| Remote button | Action |
| --- | --- |
| Left / Right | Move between tabs |
| Up / Down | Move between Settings rows |
| OK | Activate a source or change the selected setting |
| Back | Close details |

Slideshow intervals are 1 minute, 5 minutes, 15 minutes, 30 minutes, 1 hour, 3 hours, and 12 hours. The default is 1 hour.

## Sources

### Bing Wallpapers

MyTV Art displays recent Bing homepage images that Bing marks as available for wallpaper use. The app keeps a small local cache for offline playback and shows the photographer or rightsholder information in the details view.

### Daily Motivation

Daily Motivation contains community-contributed short reflections bundled with the app. It works completely offline and shuffles the bundled catalog each time the source loads. New original or appropriately licensed quotes and optional background images can be proposed through pull requests; contributor instructions are in [`assets/quotes/README.md`](./assets/quotes/README.md).

## Learn more

MyTV Art is free, ad-free, and open source.

Visit **github.com/thammegowda/mytv** to submit favorite quotes with a pull request, report an issue, contribute improvements, or thank the author by starring the repository.

## Privacy and content

MyTV Art does not require an account. Bing images remain the property of their respective rightsholders. Images that Bing does not mark for wallpaper use are excluded.

Developer setup, testing, packaging, and TV installation instructions are in [README-dev.md](./README-dev.md).

## License

MyTV Art software is available under the [MIT License](./LICENSE). Bing images remain subject to their respective rightsholders' terms. Community quotes and optional quote images use the license declared in each JSONL record.
