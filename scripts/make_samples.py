"""Generate Unpinned's fictional sample images and test fixtures.

Every name, address, booking code, and network in these files is made up.
The GPS position is the Cloud Gate sculpture in Chicago's Millennium Park, a
public place, so no private home is ever pointed at.

Requires Pillow and piexif:  python3 -m pip install pillow piexif
Run from the repository root:  npm run samples
"""

from __future__ import annotations

import io
import struct
import subprocess
import tempfile
from pathlib import Path

import piexif
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from PIL.PngImagePlugin import PngInfo

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "public" / "samples"
FIXTURES = ROOT / "tests" / "fixtures"

FONT_DIRS = [Path("/System/Library/Fonts/Supplemental"), Path("/Library/Fonts"), Path("/usr/share/fonts/truetype/dejavu")]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = ["Arial Bold.ttf", "DejaVuSans-Bold.ttf"] if bold else ["Arial.ttf", "DejaVuSans.ttf"]
    for directory in FONT_DIRS:
        for name in names:
            if (directory / name).exists():
                return ImageFont.truetype(str(directory / name), size)
    return ImageFont.load_default(size)


def rational(value: float, denominator: int = 100) -> tuple[int, int]:
    return (round(value * denominator), denominator)


def dms(value: float) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    value = abs(value)
    degrees = int(value)
    minutes_full = (value - degrees) * 60
    minutes = int(minutes_full)
    seconds = (minutes_full - minutes) * 60
    return ((degrees, 1), (minutes, 1), rational(seconds))


def jpeg_bytes(image: Image.Image, quality: int = 90, exif: bytes | None = None) -> bytes:
    out = io.BytesIO()
    kwargs = {"quality": quality, "optimize": True}
    if exif:
        kwargs["exif"] = exif
    image.convert("RGB").save(out, "JPEG", **kwargs)
    return out.getvalue()


def png_bytes(image: Image.Image, text: dict[str, str] | None = None) -> bytes:
    out = io.BytesIO()
    info = PngInfo()
    for key, value in (text or {}).items():
        info.add_text(key, value)
    image.save(out, "PNG", pnginfo=info if text else None, optimize=True)
    return out.getvalue()


def insert_after_soi(jpeg: bytes, *segments: bytes) -> bytes:
    assert jpeg[:2] == b"\xff\xd8"
    return jpeg[:2] + b"".join(segments) + jpeg[2:]


def segment(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


# ---------------------------------------------------------------- barcodes


def make_barcodes(tmp: Path) -> dict[str, Image.Image]:
    subprocess.run(["node", str(ROOT / "scripts" / "make-barcodes.mjs"), str(tmp)], check=True, cwd=ROOT)
    return {
        "aztec": Image.open(tmp / "boarding-pass-aztec.png").convert("RGB"),
        "wifi": Image.open(tmp / "wifi-qr.png").convert("RGB"),
    }


# ---------------------------------------------------------------- desk photo


def desk_scene(wifi_qr: Image.Image) -> Image.Image:
    """A 2400x1600 room. The listing photo is cropped from its right side."""
    width, height = 2400, 1600
    scene = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(scene)

    # Wall with a soft vertical gradient, then a plank floor.
    for y in range(1120):
        shade = int(236 - y * 0.035)
        draw.line([(0, y), (width, y)], fill=(shade, shade - 9, shade - 24))
    for y in range(1120, height):
        draw.line([(0, y), (width, y)], fill=(176, 128, 84))
    for x in range(-200, width, 260):
        draw.line([(x, 1120), (x - 120, height)], fill=(150, 104, 64), width=4)
    draw.rectangle([0, 1104, width, 1124], fill=(242, 238, 230))

    # Left side, cropped out of the listing: the apartment door and its number.
    draw.rectangle([150, 260, 690, 1110], fill=(122, 74, 52))
    draw.rectangle([190, 300, 650, 1110], fill=(138, 86, 60))
    draw.rectangle([250, 360, 590, 640], outline=(110, 66, 45), width=10)
    draw.rectangle([250, 700, 590, 1040], outline=(110, 66, 45), width=10)
    draw.ellipse([590, 700, 630, 740], fill=(214, 182, 96))
    draw.text((420, 470), "42", font=font(260, bold=True), fill=(230, 196, 104), anchor="mm")
    draw.rounded_rectangle([230, 175, 610, 245], radius=12, fill=(245, 242, 234), outline=(90, 90, 90), width=3)
    draw.text((420, 210), "THE SAMPLES", font=font(44, bold=True), fill=(40, 40, 40), anchor="mm")

    # Wi-Fi card on the wall, inside the listing crop.
    draw.rectangle([1650, 420, 1990, 800], fill=(255, 255, 255), outline=(60, 60, 60), width=6)
    draw.text((1820, 462), "Guest Wi-Fi", font=font(40, bold=True), fill=(30, 30, 30), anchor="mm")
    qr = wifi_qr.resize((240, 240), Image.NEAREST)
    scene.paste(qr, (1700, 495))
    draw.text((1820, 765), "Scan to join", font=font(28), fill=(70, 70, 70), anchor="mm")

    # The desk for sale.
    draw.rectangle([950, 1170, 2280, 1215], fill=(92, 62, 40))
    draw.rectangle([970, 1040, 2260, 1180], fill=(160, 110, 70))
    draw.rectangle([970, 1040, 2260, 1066], fill=(184, 132, 88))
    draw.rectangle([1000, 1180, 1050, 1540], fill=(120, 80, 52))
    draw.rectangle([2180, 1180, 2230, 1540], fill=(120, 80, 52))
    draw.rectangle([1800, 1180, 2160, 1460], fill=(150, 102, 64))
    for top in (1210, 1300, 1390):
        draw.rectangle([1820, top, 2140, top + 70], outline=(118, 78, 50), width=5)
        draw.rectangle([1955, top + 28, 2005, top + 40], fill=(214, 182, 96))

    # Lamp and plant.
    draw.polygon([(1060, 760), (1260, 760), (1210, 640), (1110, 640)], fill=(240, 214, 140))
    draw.rectangle([1155, 760, 1170, 1030], fill=(70, 70, 70))
    draw.ellipse([1090, 1015, 1235, 1050], fill=(70, 70, 70))
    draw.rectangle([2030, 930, 2160, 1042], fill=(196, 104, 70))
    for dx, dy in ((-40, -150), (10, -190), (60, -140), (-70, -90), (90, -80)):
        draw.ellipse([2095 + dx - 45, 930 + dy, 2095 + dx + 45, 930 + dy + 120], fill=(70, 130, 74))

    # An envelope with a printed address label, leaning against the lamp base.
    draw.rectangle([1290, 830, 1990, 1040], fill=(250, 248, 242), outline=(170, 160, 140), width=4)
    draw.rectangle([1330, 860, 1950, 1015], fill=(255, 255, 255))
    lines = ["ALEX SAMPLE", "42 EXAMPLE LANE, APT 3", "SAMPLEVILLE, CA 90000"]
    for index, line in enumerate(lines):
        draw.text((1350, 868 + index * 48), line, font=font(38, bold=index == 0), fill=(20, 20, 20))

    # A little sensor noise and softness so it reads as a photo.
    noise = Image.effect_noise((width, height), 9).convert("RGB")
    scene = Image.blend(scene, noise, 0.04)
    return scene.filter(ImageFilter.GaussianBlur(0.8))


def desk_photo(wifi_qr: Image.Image) -> bytes:
    scene = desk_scene(wifi_qr)
    listing = scene.crop((800, 400, 2400, 1600))
    thumbnail = scene.resize((192, 128), Image.LANCZOS)

    lat, lon = 41.8827, -87.6233
    exif = {
        "0th": {
            piexif.ImageIFD.Make: b"Sample",
            piexif.ImageIFD.Model: b"Demo Phone 7",
            piexif.ImageIFD.Software: b"DemoOS 26.1",
            piexif.ImageIFD.DateTime: b"2026:10:26 18:44:03",
            piexif.ImageIFD.Orientation: 1,
            piexif.ImageIFD.XResolution: (72, 1),
            piexif.ImageIFD.YResolution: (72, 1),
            piexif.ImageIFD.ResolutionUnit: 2,
        },
        "Exif": {
            piexif.ExifIFD.DateTimeOriginal: b"2026:10:26 18:42:10",
            piexif.ExifIFD.DateTimeDigitized: b"2026:10:26 18:42:10",
            36881: b"-05:00",  # OffsetTimeOriginal
            piexif.ExifIFD.LensMake: b"Sample",
            piexif.ExifIFD.LensModel: b"Demo Phone 7 back camera 6.9mm f/1.8",
            piexif.ExifIFD.FNumber: (18, 10),
            piexif.ExifIFD.ExposureTime: (1, 60),
            piexif.ExifIFD.ISOSpeedRatings: 320,
            piexif.ExifIFD.FocalLength: (69, 10),
            piexif.ExifIFD.PixelXDimension: listing.width,
            piexif.ExifIFD.PixelYDimension: listing.height,
            piexif.ExifIFD.ImageUniqueID: b"5f0c3a9e7d2b4c61a8e0f1d2c3b4a596",
        },
        "GPS": {
            piexif.GPSIFD.GPSLatitudeRef: b"N",
            piexif.GPSIFD.GPSLatitude: dms(lat),
            piexif.GPSIFD.GPSLongitudeRef: b"W",
            piexif.GPSIFD.GPSLongitude: dms(lon),
            piexif.GPSIFD.GPSAltitudeRef: 0,
            piexif.GPSIFD.GPSAltitude: (181, 1),
            piexif.GPSIFD.GPSImgDirectionRef: b"T",
            piexif.GPSIFD.GPSImgDirection: (3125, 10),
            piexif.GPSIFD.GPSDateStamp: b"2026:10:26",
            piexif.GPSIFD.GPSTimeStamp: ((23, 1), (42, 1), (10, 1)),
            31: (47, 10),  # GPSHPositioningError, in meters
        },
        "1st": {
            piexif.ImageIFD.Compression: 6,
            piexif.ImageIFD.XResolution: (72, 1),
            piexif.ImageIFD.YResolution: (72, 1),
            piexif.ImageIFD.ResolutionUnit: 2,
        },
        "thumbnail": jpeg_bytes(thumbnail, quality=80),
    }
    return jpeg_bytes(listing, quality=88, exif=piexif.dump(exif))


# ---------------------------------------------------------------- screenshots

PHONE = (780, 1690)
INK = (24, 32, 48)
MUTED = (96, 106, 122)


def status_bar(draw: ImageDraw.ImageDraw, width: int) -> None:
    draw.text((56, 40), "9:41", font=font(30, bold=True), fill=INK)
    for index in range(4):
        draw.rectangle([width - 170 + index * 14, 56 - index * 6, width - 162 + index * 14, 64], fill=INK)
    draw.rounded_rectangle([width - 96, 42, width - 44, 66], radius=6, outline=INK, width=3)
    draw.rectangle([width - 92, 46, width - 60, 62], fill=INK)


def boarding_pass(aztec: Image.Image) -> bytes:
    width, height = PHONE
    image = Image.new("RGB", (width, height), (244, 246, 250))
    draw = ImageDraw.Draw(image)
    status_bar(draw, width)

    draw.rounded_rectangle([32, 110, width - 32, height - 60], radius=36, fill=(255, 255, 255))
    draw.rounded_rectangle([32, 110, width - 32, 330], radius=36, fill=(30, 78, 140))
    draw.rectangle([32, 290, width - 32, 330], fill=(30, 78, 140))
    draw.text((80, 150), "SAMPLE AIR", font=font(40, bold=True), fill=(255, 255, 255))
    draw.text((80, 205), "Boarding pass", font=font(30), fill=(214, 228, 245))
    draw.text((80, 250), "Made-up sample. Not a real ticket.", font=font(24), fill=(214, 228, 245))

    draw.text((80, 370), "SFO", font=font(96, bold=True), fill=INK)
    draw.text((width - 80, 370), "JFK", font=font(96, bold=True), fill=INK, anchor="ra")
    draw.text((80, 480), "San Francisco", font=font(28), fill=MUTED)
    draw.text((width - 80, 480), "New York", font=font(28), fill=MUTED, anchor="ra")
    draw.line([(330, 430), (450, 430)], fill=MUTED, width=4)
    draw.polygon([(450, 418), (474, 430), (450, 442)], fill=MUTED)

    rows = [
        ("Passenger", "ALEX SAMPLE"),
        ("Flight", "XX 123"),
        ("Date", "28 Oct 2026"),
        ("Seat", "14C"),
        ("Booking reference", "ZX7Q4P"),
        ("Frequent flyer", "XX 4417229018"),
    ]
    y = 560
    for label, value in rows:
        draw.text((80, y), label, font=font(26), fill=MUTED)
        draw.text((80, y + 34), value, font=font(36, bold=True), fill=INK)
        y += 96

    code = aztec.resize((420, 420), Image.NEAREST)
    image.paste(code, ((width - 420) // 2, 1150))
    draw.text((width // 2, 1610), "Gate closes 20 minutes before departure", font=font(24), fill=MUTED, anchor="mm")
    return png_bytes(image)


def receipt_original() -> Image.Image:
    width, height = PHONE[0], 2140
    image = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    status_bar(draw, width)
    draw.text((56, 120), "Order confirmed", font=font(54, bold=True), fill=INK)
    draw.text((56, 195), "Thanks for your order, Alex!", font=font(32), fill=MUTED)
    draw.text((56, 240), "Made-up sample. Not a real order.", font=font(24), fill=MUTED)

    draw.rounded_rectangle([40, 300, width - 40, 620], radius=24, fill=(246, 247, 250))
    draw.text((72, 330), "Order #114-2938471-5520183", font=font(32, bold=True), fill=INK)
    draw.text((72, 390), "Desk lamp, brass", font=font(30), fill=INK)
    draw.text((width - 72, 390), "$34.00", font=font(30), fill=INK, anchor="ra")
    draw.text((72, 440), "Shipping", font=font(30), fill=INK)
    draw.text((width - 72, 440), "$4.99", font=font(30), fill=INK, anchor="ra")
    draw.text((72, 530), "Total paid", font=font(32, bold=True), fill=INK)
    draw.text((width - 72, 530), "$38.99", font=font(32, bold=True), fill=INK, anchor="ra")

    draw.text((56, 670), "Ship to", font=font(28, bold=True), fill=MUTED)
    for index, line in enumerate(["Alex Sample", "42 Example Lane, Apt 3", "Sampleville, CA 90000"]):
        draw.text((56, 712 + index * 46), line, font=font(32), fill=INK)

    draw.text((56, 900), "Contact", font=font(28, bold=True), fill=MUTED)
    draw.text((56, 942), "alex.sample@example.com", font=font(32), fill=INK)
    draw.text((56, 988), "(312) 555-0142", font=font(32), fill=INK)

    draw.text((56, 1080), "Arriving Thursday", font=font(36, bold=True), fill=(28, 120, 80))
    draw.text((56, 1130), "We'll text you when it's on the way.", font=font(28), fill=MUTED)
    draw.rounded_rectangle([40, 1220, width - 40, 1320], radius=50, fill=(30, 78, 140))
    draw.text((width // 2, 1270), "Track package", font=font(34, bold=True), fill=(255, 255, 255), anchor="mm")

    # Everything below this line is cropped out of the shared screenshot.
    draw.text((56, 1560), "Payment", font=font(28, bold=True), fill=MUTED)
    draw.text((56, 1602), "Card number 4111 1111 1111 1111", font=font(32), fill=INK)
    draw.text((56, 1648), "Expires 09/29", font=font(32), fill=INK)
    draw.text((56, 1740), "Billing address", font=font(28, bold=True), fill=MUTED)
    draw.text((56, 1782), "42 Example Lane, Apt 3", font=font(32), fill=INK)
    return image


def receipt_with_leftovers() -> bytes:
    """Simulates the 2023 'aCropalypse' bug: an editor wrote the cropped image
    over the start of the original file without trimming the rest."""
    original = receipt_original()
    # The shared crop keeps the order details and leaves out the payment section.
    original_file = png_bytes(original, {"Software": "SampleShot 2.1"})
    cropped_file = png_bytes(original.crop((0, 0, PHONE[0], 1400)), {"Software": "SampleShot 2.1"})
    if len(original_file) <= len(cropped_file):
        raise RuntimeError("Original must be larger than the crop to leave leftovers")
    return cropped_file + original_file[len(cropped_file):]


# ---------------------------------------------------------------- extra fixtures


def small_photo(color: tuple[int, int, int], size: tuple[int, int] = (96, 64)) -> Image.Image:
    image = Image.new("RGB", size, color)
    draw = ImageDraw.Draw(image)
    draw.rectangle([size[0] // 4, size[1] // 4, size[0] // 2, size[1] // 2], fill=(255, 255, 255))
    return image


def orientation_fixture() -> bytes:
    exif = {
        "0th": {piexif.ImageIFD.Orientation: 6, piexif.ImageIFD.Make: b"Sample", piexif.ImageIFD.Model: b"Demo Cam"},
        "Exif": {piexif.ExifIFD.DateTimeOriginal: b"2026:10:20 09:15:00", piexif.ExifIFD.BodySerialNumber: b"SN-0000-1234"},
        "GPS": {
            piexif.GPSIFD.GPSLatitudeRef: b"N",
            piexif.GPSIFD.GPSLatitude: dms(51.5079),
            piexif.GPSIFD.GPSLongitudeRef: b"W",
            piexif.GPSIFD.GPSLongitude: dms(0.0877),
        },
    }
    return jpeg_bytes(small_photo((40, 120, 200)), exif=piexif.dump(exif))


XMP_PACKET = """<?xpacket begin='\ufeff' id='W5M0MpCehiHzreSzNTczkc9d'?>
<x:xmpmeta xmlns:x='adobe:ns:meta/'>
 <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
  <rdf:Description rdf:about=''
    xmlns:dc='http://purl.org/dc/elements/1.1/'
    xmlns:photoshop='http://ns.adobe.com/photoshop/1.0/'
    xmlns:xmp='http://ns.adobe.com/xap/1.0/'
    xmlns:xmpMM='http://ns.adobe.com/xap/1.0/mm/'
    xmlns:stEvt='http://ns.adobe.com/xap/1.0/sType/ResourceEvent#'
    photoshop:City='Sampleville'
    photoshop:State='CA'
    photoshop:Country='United States'
    xmp:CreatorTool='Sample Photo Editor 4.2'>
   <dc:creator><rdf:Seq><rdf:li>Alex Sample</rdf:li></rdf:Seq></dc:creator>
   <xmpMM:History><rdf:Seq>
    <rdf:li rdf:parseType='Resource' stEvt:action='saved'
      stEvt:softwareAgent='Sample Photo Editor 4.2'
      stEvt:changed='/' stEvt:when='2026-10-21T10:02:11-05:00'/>
   </rdf:Seq></xmpMM:History>
   <xmpMM:DerivedFrom rdf:parseType='Resource'>
    <stRef:filePath xmlns:stRef='http://ns.adobe.com/xap/1.0/sType/ResourceRef#'>C:\\Users\\alexs\\Pictures\\IMG_2041.CR3</stRef:filePath>
   </xmpMM:DerivedFrom>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end='w'?>"""


def iptc_dataset(record: int, dataset: int, value: bytes) -> bytes:
    return bytes([0x1C, record, dataset]) + struct.pack(">H", len(value)) + value


def xmp_iptc_fixture() -> bytes:
    xmp = segment(0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + XMP_PACKET.encode("utf-8"))
    iptc = b"".join(
        [
            iptc_dataset(2, 0, b"\x00\x04"),
            iptc_dataset(2, 80, b"Alex Sample"),
            iptc_dataset(2, 90, b"Sampleville"),
            iptc_dataset(2, 101, b"United States"),
            iptc_dataset(2, 120, b"View from our balcony"),
        ]
    )
    if len(iptc) % 2:
        iptc += b"\x00"
    irb = b"8BIM" + struct.pack(">H", 0x0404) + b"\x00\x00" + struct.pack(">I", len(iptc)) + iptc
    photoshop = segment(0xED, b"Photoshop 3.0\x00" + irb)
    comment = segment(0xFE, b"Taken from the balcony at home")
    return insert_after_soi(jpeg_bytes(small_photo((200, 120, 40))), xmp, photoshop, comment)


MOTION_XMP = """<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
<rdf:Description rdf:about='' xmlns:GCamera='http://ns.google.com/photos/1.0/camera/' GCamera:MotionPhoto='1' GCamera:MotionPhotoVersion='1'/>
</rdf:RDF></x:xmpmeta>"""


def motion_photo_fixture() -> bytes:
    xmp = segment(0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + MOTION_XMP.encode("utf-8"))
    jpeg = insert_after_soi(jpeg_bytes(small_photo((90, 160, 90))), xmp)
    # A tiny stand-in for the MP4 clip that motion photos append after the image.
    ftyp = struct.pack(">I", 24) + b"ftypmp42" + b"\x00\x00\x00\x00" + b"mp42isom"
    mdat = struct.pack(">I", 8 + 2048) + b"mdat" + bytes(2048)
    return jpeg + ftyp + mdat


def webp_fixture() -> bytes:
    exif = piexif.dump(
        {
            "0th": {piexif.ImageIFD.Make: b"Sample", piexif.ImageIFD.Model: b"Demo Phone 7"},
            "GPS": {
                piexif.GPSIFD.GPSLatitudeRef: b"S",
                piexif.GPSIFD.GPSLatitude: dms(33.8568),
                piexif.GPSIFD.GPSLongitudeRef: b"E",
                piexif.GPSIFD.GPSLongitude: dms(151.2153),
            },
        }
    )
    out = io.BytesIO()
    small_photo((120, 60, 160)).save(out, "WEBP", exif=exif, xmp=MOTION_XMP.encode("utf-8"), quality=90)
    return out.getvalue()


def main() -> None:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    FIXTURES.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        codes = make_barcodes(Path(tmp))

    desk = desk_photo(codes["wifi"])
    boarding = boarding_pass(codes["aztec"])
    receipt = receipt_with_leftovers()

    outputs = {
        SAMPLES / "desk-for-sale.jpg": desk,
        SAMPLES / "boarding-pass.png": boarding,
        SAMPLES / "order-receipt.png": receipt,
        FIXTURES / "desk-for-sale.jpg": desk,
        FIXTURES / "boarding-pass.png": boarding,
        FIXTURES / "order-receipt.png": receipt,
        FIXTURES / "orientation-6.jpg": orientation_fixture(),
        FIXTURES / "xmp-iptc.jpg": xmp_iptc_fixture(),
        FIXTURES / "motion-photo.jpg": motion_photo_fixture(),
        FIXTURES / "exif.webp": webp_fixture(),
        FIXTURES / "plain.png": png_bytes(small_photo((10, 10, 10))),
        FIXTURES / "truncated.jpg": desk[:2048],
        FIXTURES / "not-an-image.jpg": b"This is a text file pretending to be a photo.\n",
    }
    for path, data in outputs.items():
        path.write_bytes(data)
        print(f"{path.relative_to(ROOT)}  {len(data):>8,} bytes")


if __name__ == "__main__":
    main()
