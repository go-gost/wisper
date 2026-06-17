#!/bin/bash
# create-package-xml.sh — Generate package.xml matching SDK format exactly.
#
# Usage: create-package-xml.sh <path> <revision> <api> <abi>
#   path     — SDK package path (e.g., "emulator" or "system-images;android-34;google_apis;x86_64")
#   revision — Version (e.g., "36.6.11" or "14")
#   api      — API level for sys-img (e.g., "34"), or "0" for generic packages
#   abi      — ABI for sys-img (e.g., "x86_64"), or "-" for generic packages
#
# Parses the path to extract tag (google_apis vs default) and vendor.

set -e

SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
PKG_PATH="$1"
REV="$2"
API_LEVEL="$3"
ABI="$4"

IFS='.' read -r MAJOR MINOR MICRO <<< "${REV}"

PKG_DIR="${SDK_ROOT}/${PKG_PATH//;///}"
mkdir -p "${PKG_DIR}"

# Determine type-details based on package path
if [[ "${PKG_PATH}" == system-images* ]]; then
    # sys-img: ns12:sysImgDetailsType with tag, vendor, api-level, abi
    # path format: system-images;android-<api>;<tag>;<abi>
    IFS=';' read -ra PARTS <<< "${PKG_PATH}"
    SYSIMG_TAG="${PARTS[2]:-google_apis}"
    SYSIMG_TAG_DISPLAY="$(echo "${SYSIMG_TAG}" | sed 's/_/ /g' | sed 's/default/Default API/; s/google_apis/Google APIs/; s/google_atd/Google ATD/; s/google-tv/Google TV/; s/android-tv/Android TV/; s/android-wear/Android Wear/; s/aosp_atd/AOSP ATD/')"

    SYSIMG_VENDOR="google"
    SYSIMG_VENDOR_DISPLAY="Google Inc."

    TYPE_DETAILS="<type-details xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:type=\"ns12:sysImgDetailsType\"><api-level>${API_LEVEL}</api-level><tag><id>${SYSIMG_TAG}</id><display>${SYSIMG_TAG_DISPLAY}</display></tag><vendor><id>${SYSIMG_VENDOR}</id><display>${SYSIMG_VENDOR_DISPLAY}</display></vendor><abi>${ABI}</abi></type-details>"

    DISP_NAME="$(echo "${SYSIMG_TAG_DISPLAY} Intel x86_64 Atom System Image" | sed 's/Default API //')"
else
    # generic: ns4:genericDetailsType (self-closing, no extra fields)
    TYPE_DETAILS="<type-details xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:type=\"ns4:genericDetailsType\"/>"
    DISP_NAME="${PKG_PATH}"
fi

cat > "${PKG_DIR}/package.xml" << XMLEND
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02" xmlns:ns3="http://schemas.android.com/repository/android/common/01" xmlns:ns4="http://schemas.android.com/repository/android/generic/01" xmlns:ns5="http://schemas.android.com/repository/android/generic/02" xmlns:ns6="http://schemas.android.com/sdk/android/repo/addon2/01" xmlns:ns7="http://schemas.android.com/sdk/android/repo/addon2/02" xmlns:ns8="http://schemas.android.com/sdk/android/repo/addon2/03" xmlns:ns9="http://schemas.android.com/sdk/android/repo/repository2/01" xmlns:ns10="http://schemas.android.com/sdk/android/repo/repository2/02" xmlns:ns11="http://schemas.android.com/sdk/android/repo/repository2/03" xmlns:ns12="http://schemas.android.com/sdk/android/repo/sys-img2/03" xmlns:ns13="http://schemas.android.com/sdk/android/repo/sys-img2/02" xmlns:ns14="http://schemas.android.com/sdk/android/repo/sys-img2/01"><license id="android-sdk-license" type="text">Android SDK License</license><localPackage path="${PKG_PATH}" obsolete="false">${TYPE_DETAILS}<revision><major>${MAJOR}</major><minor>${MINOR:-0}</minor><micro>${MICRO:-0}</micro></revision><display-name>${DISP_NAME}</display-name></localPackage></ns2:repository>
XMLEND

echo "  ✓ package.xml written for ${PKG_PATH} v${REV}"
