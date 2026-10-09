# MyTV Art for Samsung TV

MyTV Art turns a Samsung TV into a calm, subscription-free ambient display.

It currently includes:

- Daily Bing photography
- Offline wallpaper caching
- Original motivational quote artwork
- A remote-first book library and paginated reader
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

Choose **Books** in the details view to open the library.

While browsing books:

| Remote button | Action |
| --- | --- |
| Direction keys | Choose a book |
| OK | Open the selected book |
| Back | Return to artwork |

While reading:

| Remote button | Action |
| --- | --- |
| Left / Right | Previous or next two-page spread |
| Channel Down / Up | Previous or next chapter |
| Up | Open the table of contents |
| OK / Play-Pause | Narration control when a phone is connected |
| Back | Return to the book library |

The current build includes an original bundled demo book. A paired-phone provider can replace the bundled provider without changing the TV reading interface.

Slideshow intervals are 1 minute, 5 minutes, 15 minutes, 30 minutes, 1 hour, 3 hours, and 12 hours. The default is 1 hour.

## Sources

### Bing Wallpapers

MyTV Art displays recent Bing homepage images that Bing marks as available for wallpaper use. [Microsoft Support states](https://support.microsoft.com/en-us/bing/explore-the-homepage) that most daily images can be downloaded to use as wallpaper and that images with additional licensing restrictions are not made available for download.

Bing's [live homepage metadata feed](https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US) labels downloadable images with:

> Download this image. Use of this image is restricted to wallpaper only.

MyTV Art therefore accepts only records marked `wp: true`, uses the images only as wallpapers, keeps a bounded local cache for offline playback, and shows the photographer or rightsholder information in the details view. This narrow wallpaper permission does not grant redistribution or other reuse rights; use remains subject to the [Microsoft Terms of Use](https://www.microsoft.com/en-us/legal/terms-of-use) and the rights of each image's owner.

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
