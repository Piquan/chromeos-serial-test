// Adjust as needed.  You can also change this in the console, and it
// will take effect the next time you click "Go".
var connOptions = { bitrate: 9600 };

var decoder = new TextDecoder("utf-8");
var running = false;

function receiveHandler(info) {
    // Some sort of special \r handling is required.
    // newData might end in just a \r (because the \n is still in the
    // buffer), and Chrome will treat adding a trailing \r
    // to innerText as adding a trailing \n, then it will add a second
    // \n when you send the real \n.  You could also just remove \r
    // characters if you prefer.
    var newData = 
        decoder.decode(info.data)
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n\n");
    document.getElementById("c").innerText += newData;
    // Scroll the body to keep the bottom in view.
    document.body.scrollTop = document.body.scrollHeight;
}
function receiveHandlerTrampoline(info) {
    // This is just here to make it easy to change receiveHandler
    // from the console without needing to reset the event
    // handlers.
    receiveHandler(info);
}

function receiveErrorHandler(info) {
    document.getElementById("c").innerText += "\n\nSERIAL ERROR: " + info.error + "\n\n";
    document.body.scrollTop = document.body.scrollHeight;
}
function receiveErrorHandlerTrampoline(info) {
    receiveErrorHandler(info);
}

function goClicked() {
    if (!running) {
        // Set everything up.  Because I'm lazy, I just connect to all
        // the devices instead of making a nice device selector.
        chrome.serial.getDevices(connect);
        function connect (deviceInfos) {
            for (var deviceInfo of deviceInfos) {
                chrome.serial.connect(deviceInfo.path, connOptions, ()=>{});
            }
        }
        document.getElementById("go").innerHTML = "Stop";
        running = true;
    } else {
        chrome.serial.getConnections(disconnect);
        function disconnect (connectionInfos) {
            for (var conn of connectionInfos) {
                chrome.serial.disconnect(conn.connectionId, ()=>{});
            }
        }
        document.getElementById("go").innerHTML = "Go";
        running = false;
    }
}

function init() {
    chrome.serial.onReceive.addListener(receiveHandlerTrampoline);
    chrome.serial.onReceiveError.addListener(receiveErrorHandlerTrampoline);
    document.getElementById("go").addEventListener('click', goClicked);
}
window.addEventListener('DOMContentLoaded', init);