iOS parity fixtures, written by opencatio3d-ios InteropTests (scripts/verify-web-interop.sh).
Each <case>.openplan3d.json is the iOS export of the web case of the same name (ios-sample: the
app's own sample catio); <case>.expected.json is the Swift generator + checks output for it.
tests/interop.test.ts imports each file and must reproduce the summary. Do not edit by hand.
