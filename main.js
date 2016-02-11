// Adjust as needed.  You can also change this in the console, and it
// will take effect the next time you click "Go".
var connOptions = { bitrate: 115200 };

var decoder = new TextDecoder("utf-8");
var running = false;

// If we try to update the DOM as we receive serial data, it is WAY
// too slow, and the app looks to the user like it locked up, or is
// still showing data after the Stop button is pressed.  But by
// batching updates to run at 30 Hz, things go smoothly.
var pendingDisplay = [];
function updateDisplay() {
    // Some sort of special \r handling is required.
    // newData might end in just a \r (because the \n is still in the
    // buffer), and Chrome will treat adding a trailing \r to
    // innerText as adding a trailing \n, then it will add a second
    // \n when you send the real \n.  You could also just remove \r
    // characters if you prefer.
    var newData =
        pendingDisplay
        .map((x) => {return decoder.decode(x)})
        .join("")
        .replace(/[\r\n<>&]/g, 
                 function (ch) {
                     return {"\r" : "\\r", "\n" : "\\n\n",
                             "<" : "&lt;", ">" : "&gt;", "&" : "&amp;"}
                            [ch];
                 });
    var c = document.getElementById("c");
    // Save just the last 1MB of data.  FIXME It would be nice to
    // avoid cutting off an entity partway through, which is harmless
    // but ugly.  It's more important to avoid cutting off an element
    // partway through, which has a greater impact.
    // We use innerHTML instead of textContent because we want to
    // preserve any <hr/> marks in here.
    c.innerHTML = (c.innerHTML + newData).slice(-1048576);
    // Scroll the body to keep the bottom in view.
    c.scrollTop = c.scrollHeight;
    pendingDisplay = [];
}

function receiveHandler(info) {
    if (pendingDisplay.length == 0)
        window.setTimeout(updateDisplay, 33);
    pendingDisplay.push(info.data);
}

function receiveErrorHandler(info) {
    updateDisplay();
    var c = document.getElementById("c");
    c.innerHTML += '\n\n<span style="text-size:200%; color:red">SERIAL ERROR: '
                   + info.error + '</span>\n\n';
    c.scrollTop = c.scrollHeight;
}

function goClicked() {
    if (!running) {
        // Set everything up.  Because I'm lazy, I just connect to all
        // the devices instead of making a nice device selector.
        chrome.serial.getDevices(connect);
        function connect (deviceInfos) {
            for (var deviceInfo of deviceInfos) {
                console.log("Connecting", deviceInfo.path);
                chrome.serial.connect(deviceInfo.path, connOptions,
                                      handleNewConn);
            }
            function handleNewConn(connectionInfo) {
                // Flush the input buffer on each new connection.  Note
                // that we can receive data between when we issue the flush
                // and when it completes, so erase anything from
                // pendingDisplay.  (We expect the flush will be less
                // than the 33ms update delay, or else we'd have to take
                // other measures too.)
                chrome.serial.flush(connectionInfo.connectionId, flushComplete);
            }
            function flushComplete() {
                // This will be called once for each serial device that
                // is successfully connected.
                pendingDisplay = [];
                if (document.getElementById("clear_on_restart").checked) {
                    document.getElementById("c").innerHTML = "";
                }
            }
        }
        document.getElementById("go").innerHTML = "Stop";
        running = true;
    } else {
        chrome.serial.getConnections(disconnect);
        var disconnectsPending;
        function disconnect (connectionInfos) {
            console.log("Disconnecting", connectionInfos.length, "devices");
            disconnectsPending = connectionInfos.length;
            for (var conn of connectionInfos) {
                chrome.serial.disconnect(conn.connectionId, disconnectDone);
            }
        }
        function disconnectDone () {
            disconnectsPending--;
            if (disconnectsPending == 0) {
                console.log("Disconnected");
                updateDisplay();
                document.getElementById("c").innerHTML += "<hr />";
            }
        }
        document.getElementById("go").innerHTML = "Go";
        running = false;
    }
}

function init() {
    chrome.serial.onReceive.addListener(receiveHandler);
    chrome.serial.onReceiveError.addListener(receiveErrorHandler);
    document.getElementById("go").addEventListener('click', goClicked);
}
window.addEventListener('DOMContentLoaded', init);