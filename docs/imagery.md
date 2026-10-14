# Image sources

Seller listing photos are kept as supplied by their source and are never replaced with generated inventory photos. The app's reference photos are labeled separately and are not evidence of a listing's condition or fitment.

## Bundled references

| Asset                                   | Original source                                                                                                                                                                                                                                                               | Processing                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `public/reference/bmw-m20.png`          | [BMWStyle's BMW M20 engine photograph](https://www.bmwstyle.ru/8-bmw-world/12-bmw-engine-motors/2286-bmw-m20/)                                                                                                                                                                | Background extraction with the built-in image generation tool.                                        |
| `public/reference/porsche-911-hood.png` | [Sierra Madre Collection, Porsche 911 front bonnet](https://sierramadrecollection.com/products/porsche-bonnet-front-911-73-89-911-511-010-01)                                                                                                                                 | Background extraction with the built-in image generation tool.                                        |
| `public/reference/transmission.png`     | [Garland JDM Motors, RX7 FC manual transmission](https://garlandjdmmotors.com/en/mazda/transmissions/mazda-cx7-aj30-mx6-ford-probe-626-rx8-rx7-mazda-6-13b-kl-fs-l3-g6-automatic-and-manual-transmission/31/1988-1991-mazda-rx7-13b-1-3l-turbo-fc-5speed-manual-transmision/) | Background extraction with the built-in image generation tool, followed by a transparency refinement. |

These photographs and their derivatives retain the original source owners' rights; the repository's MIT license applies to code, not third-party photography. Confirm appropriate image rights before reusing photographic assets in another distribution or commercial product. Reference imagery does not imply affiliation with the suppliers.

Additional remote reference images are linked to [PNGFind](https://www.pngfind.com/mpng/hixwRJw_turbo-png-transparent-background-garrett-turbo-png-download/), [VHV](https://www.vhv.rs/viewpic/TRmwxJi_brembo-png-download-brembo-png-transparent-png/), [PNGAAA](https://www.pngaaa.com/detail/1149759), and [PNGEgg](https://www.pngegg.com/ar/png-zlqde). They are optional remote references, not part of the local runtime. User-uploaded vehicle photos remain in the user's data folder.

## Background extraction prompts

Built-in mode was used, with transparent background output requested.

- **Engine:** remove only the blue-gray studio background and floor shadow. Preserve the red fan, intake manifold tubes, hoses, wires, hardware, logos, materials, perspective, colors, and geometry. Include the entire existing engine with a little transparent padding. No new parts, stylization, pedestal, glow, backplate, or text.
- **Hood:** remove the white background only. Preserve the exact hood shape, panel ridges, finish, texture, camera angle, and lighting. Keep the entire panel with a small transparent margin. No floor, shadow backplate, halo, new details, or text.
- **Transmission:** remove the warehouse background and blue pallet. Preserve the photographed gearbox, stock markings, grime, hardware, mounts, and shift lever. Do not clean, repaint, repair, or redesign it. The refinement removes surrounding haze/shadow and requests alpha-zero pixels outside the physical part.

All reference edits are illustrative. Actual listing galleries remain untouched. The logo is an original SVG in `public/logo.svg`; raster PNG/ICO files are exports of that vector, not generated photographs.
