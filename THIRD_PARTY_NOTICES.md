# Third-party notices

Unpinned is MIT-licensed (see [LICENSE](LICENSE)). It ships with or builds on these open-source components. Each keeps
its own license.

## Shipped in the web app

| Component | Version | Copyright | License |
| --- | --- | --- | --- |
| [exifr](https://github.com/MikeKovarik/exifr) | 7.1.3 | © 2020 Mike Kovařík, Mutiny.cz | MIT |
| [barcode-detector](https://github.com/Sec-ant/barcode-detector) | 3.2.3 | © 2023 Ze-Zheng Wu | MIT |
| [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) | 3.1.6 | © 2023 Ze-Zheng Wu | MIT |
| [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp), compiled into zxing-wasm | | © ZXing authors | Apache 2.0 |
| [tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | © tesseract.js contributors | Apache 2.0 |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core), which includes [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) | 7.0.0 | © tesseract.js and Tesseract contributors | Apache 2.0 |
| English model `eng.traineddata` (4.0.0 best, integer), from [tessdata](https://github.com/tesseract-ocr/tessdata) via [@tesseract.js-data/eng](https://github.com/naptha/tessdata) | 1.0.0 | © Tesseract OCR contributors | Apache 2.0 (model), MIT (package) |
| [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) via [Fontsource](https://fontsource.org/) | 5.3.0 | © 2020 Braille Institute of America, Inc. | SIL Open Font License 1.1 |
| Town names and positions from [GeoNames](https://www.geonames.org/), via [all-the-cities](https://github.com/zeke/all-the-cities) | 3.1.0 | GeoNames; package © 2018 Nabil Ashraf | Data: CC BY 4.0. Package: MIT |

The full Apache 2.0 license texts for tesseract.js and tesseract.js-core are copied next to those files when the app is
built (`public/vendor/tesseract/LICENSE-*`), and the license is at https://www.apache.org/licenses/LICENSE-2.0. The SIL
Open Font License is at https://openfontlicense.org.

**GeoNames attribution:** `src/data/places.txt` is a reduced copy of GeoNames place data (towns with 15,000 or more
people: name, country, US state, and position rounded to 0.01°), made by `scripts/build-places.mjs`. GeoNames data is
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: filtered by population and feature
type, and coordinates rounded.

## Used only to build, test, or make the examples

| Component | License |
| --- | --- |
| [Vite](https://vite.dev/) | MIT |
| [Vitest](https://vitest.dev/) | MIT |
| [TypeScript](https://www.typescriptlang.org/) | Apache 2.0 |
| [Pillow](https://python-pillow.org/) | MIT-CMU |
| [piexif](https://github.com/hMatoba/Piexif) | MIT |

## MIT license text

The MIT-licensed components above are distributed under this text, with each one's copyright line from the tables.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Made for this project

The app icon, the three example pictures, and the test files were made for Unpinned. Every name, address, booking
code, card number, and network in them is fictional.
