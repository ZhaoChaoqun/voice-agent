"""Reproduce a fast 60-second PCM burst in real WebAudio without Azure quota."""

import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8768")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(reduced_motion="reduce")
        page.goto(args.url)
        page.wait_for_load_state("networkidle")
        page.evaluate("""() => {
            const start = document.createElement('button');
            start.id = 'buffer-regression-start';
            start.textContent = 'Start isolated playback regression';
            start.style.position = 'fixed'; start.style.top = '0'; start.style.zIndex = '999';
            start.onclick = async () => {
                window.__bufferRegression = {error:null, started:false};
                try {
                    const {VoiceAudio} = await import('/audio.mjs');
                    const result = window.__bufferRegression;
                    result.player = new VoiceAudio(() => {}, () => {}, error => {result.error = error.message;});
                    await result.player.resumed;
                    const bytes = new Uint8Array(4800), view = new DataView(bytes.buffer);
                    for (let index = 0; index < 2400; index++)
                        view.setInt16(index*2, Math.round(300*Math.sin(2*Math.PI*440*index/24000)), true);
                    result.chunk = btoa(String.fromCharCode(...bytes));
                    result.metadata = {response_id:'long-response',item_id:'long-item',content_index:0};
                    for (let index = 0; index < 600; index++) result.player.play(result.chunk, result.metadata);
                    result.started = true;
                } catch (error) { window.__bufferRegression.error = error.message; }
            };
            const resume = document.createElement('button');
            resume.id = 'buffer-regression-resume'; resume.textContent = 'Resume isolated playback';
            resume.style.position = 'fixed'; resume.style.top = '35px'; resume.style.zIndex = '999';
            resume.onclick = () => window.__bufferRegression.player.resume();
            document.body.append(start,resume);
        }""")
        page.locator("#buffer-regression-start").click()
        page.wait_for_function("() => window.__bufferRegression?.started || window.__bufferRegression?.error")
        assert page.evaluate("window.__bufferRegression.error") is None
        initial = page.evaluate("window.__bufferRegression.player.snapshot()")
        assert initial["receivedSeconds"] == 60, initial
        assert initial["bufferedSeconds"] > 30, initial
        assert initial["scheduledAheadSeconds"] <= .351, initial
        page.wait_for_function("() => window.__bufferRegression.player.snapshot().renderedSeconds > .3")
        paused = page.evaluate("""async () => {
            const result = window.__bufferRegression;
            await result.player.context.suspend();
            result.player.play(result.chunk,result.metadata);
            return result.player.snapshot();
        }""")
        page.wait_for_timeout(200)
        held = page.evaluate("window.__bufferRegression.player.snapshot()")
        assert held["state"] == "suspended"
        assert held["renderedSeconds"] == paused["renderedSeconds"]
        assert held["bufferedSeconds"] > 30
        assert page.evaluate("window.__bufferRegression.error") is None
        page.locator("#buffer-regression-resume").click()
        page.wait_for_function(
            "played => window.__bufferRegression.player.snapshot().renderedSeconds > played + .2",
            arg=held["renderedSeconds"],
        )
        interrupted = page.evaluate("""() => {
            const result = window.__bufferRegression;
            const reports = result.player.interrupt({response_id:'long-response',active_response:true,
                items:[{item_id:'long-item',content_index:0}]});
            return {reports,snapshot:result.player.snapshot()};
        }""")
        assert interrupted["snapshot"]["pendingSources"] == 0
        assert interrupted["snapshot"]["bufferedSeconds"] == 0
        assert interrupted["snapshot"]["queuedSeconds"] == 0
        assert 100 < interrupted["reports"][0]["audio_end_ms"] < 5000, interrupted
        assert page.evaluate("window.__bufferRegression.player.play(window.__bufferRegression.chunk,window.__bufferRegression.metadata)") is False
        assert page.evaluate("window.__bufferRegression.error") is None
        page.evaluate("window.__bufferRegression.player.dispose()")
        browser.close()
        print("PASS: real WebAudio accepted a valid 60-second burst without the old 30-second disconnect.")
        print("INITIAL:", json.dumps(initial))
        print("PAUSE/RESUME:", json.dumps(held))
        print("INTERRUPTED:", json.dumps(interrupted))


if __name__ == "__main__":
    main()
