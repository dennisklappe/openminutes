# Changelog

## [0.2.1](https://github.com/dennisklappe/openminutes/compare/v0.2.0...v0.2.1) (2026-10-28)


### Bug Fixes

* QA findings, delete-all-voices also clears stored participant voices ([#25](https://github.com/dennisklappe/openminutes/issues/25)) ([85e5da9](https://github.com/dennisklappe/openminutes/commit/85e5da964de1e80a03f81e7d7d5bb3948ca50f5a))

## [0.2.0](https://github.com/dennisklappe/openminutes/compare/v0.1.0...v0.2.0) (2026-10-28)


### Features

* cluster shared-room voices so one tile can hold several people ([#23](https://github.com/dennisklappe/openminutes/issues/23)) ([c34db2c](https://github.com/dennisklappe/openminutes/commit/c34db2c96522c1514fabb54d6a3ef5d34ab9bf36))
* import from Fireflies, AI attendee edit, several emails per person ([#13](https://github.com/dennisklappe/openminutes/issues/13)) ([7d2cbab](https://github.com/dennisklappe/openminutes/commit/7d2cbab934a117474fe3b5d8ea106ae32f2e905e))
* meeting-local anchor voices for the voice check ([#21](https://github.com/dennisklappe/openminutes/issues/21)) ([9b8798d](https://github.com/dennisklappe/openminutes/commit/9b8798d23ed8c06951d239dcc43f7bb4d31461ab))
* People tab with voice profiles and speaker suggestions ([#14](https://github.com/dennisklappe/openminutes/issues/14)) ([8416865](https://github.com/dennisklappe/openminutes/commit/841686544b56fc200833ab100314ab23099b92fc))
* review all people with scopes, do not track and a merge UI ([#16](https://github.com/dennisklappe/openminutes/issues/16)) ([a551a98](https://github.com/dennisklappe/openminutes/commit/a551a984f648fa770049c1b2674db721c62d5862))
* review cards with skip, approve and disapprove, and a profile backfill for everyone ([#15](https://github.com/dennisklappe/openminutes/issues/15)) ([a050868](https://github.com/dennisklappe/openminutes/commit/a050868f271b23aa4f7a5bac54fe475a38fef960))
* shared accounts as real people, with a how-many question and per-person emails ([#24](https://github.com/dennisklappe/openminutes/issues/24)) ([b945501](https://github.com/dennisklappe/openminutes/commit/b9455015f41a05e007b291584561e63fe4cdab3b))
* smart review queue, per-language voice profiles, auto-learning and relative scoring ([#18](https://github.com/dennisklappe/openminutes/issues/18)) ([101bf35](https://github.com/dennisklappe/openminutes/commit/101bf356f296ddd3fbe2116774ebc82b21ff9e2a))


### Bug Fixes

* count what the review queue asks, not every unsure line ([#20](https://github.com/dennisklappe/openminutes/issues/20)) ([333c952](https://github.com/dennisklappe/openminutes/commit/333c9529ae38925287e52d8019fd4d54e616bcf8))
* **deps:** override esbuild below 0.25.0 ([#11](https://github.com/dennisklappe/openminutes/issues/11)) ([565e71f](https://github.com/dennisklappe/openminutes/commit/565e71f0003d054071b9ce9419bed33b73586e98))
* no profiles for shared mailboxes, list people who joined by default ([#17](https://github.com/dennisklappe/openminutes/issues/17)) ([2d26739](https://github.com/dennisklappe/openminutes/commit/2d2673932f44ad5d5181a3893f6907df7bc046a8))
* **worker:** run the voice check before the original audio is moved away ([#22](https://github.com/dennisklappe/openminutes/issues/22)) ([509291c](https://github.com/dennisklappe/openminutes/commit/509291c63370a0175b25711020fb2689926e7d06))

## 0.1.0 (2026-10-25)


### Features

* first release ([4c3f813](https://github.com/dennisklappe/openminutes/commit/4c3f813804f7e6a846dc9f3d541387c6fc89b7dd))


### Bug Fixes

* **ci:** pin Node 22.23.4, the minimum Astro 7 supports ([#5](https://github.com/dennisklappe/openminutes/issues/5)) ([f872c63](https://github.com/dennisklappe/openminutes/commit/f872c6336a9c3712e623ed316bcaafb62b8e2a96))
* **ci:** release the first version as 0.1.0 ([#9](https://github.com/dennisklappe/openminutes/issues/9)) ([f51d130](https://github.com/dennisklappe/openminutes/commit/f51d1300f10651c324652767ca348f18adf1c67d))
