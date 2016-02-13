// Adjust as needed.  You can also change this in the console, and it
// will take effect the next time you click "Go".
var connOptions = { bitrate: 115200 };

var bootloaderInitTime = 100;
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
        .map((x) => {return String.fromCharCode.apply(String, new Uint8Array(x))})
        .join("")
        .replace(/[\x00-\x1f\x80-\xff\r\n<>&\\]/g, 
                 function (ch) {
                     var code = ch.charCodeAt(0);
                     if ((code != 0x0a && code != 0x0d && code <= 0x1f) ||
                         code >= 0x80) {
                         var hexstr = code.toString(16);
                         if (hexstr.length < 2)
                             hexstr = "0" + hexstr;
                         return "\\x" + hexstr;
                     } else {
                         return {"\r" : "\\r", "\n" : "\\n\n", "\\": "\\\\",
                                 "<" : "&lt;", ">" : "&gt;", "&" : "&amp;"}
                                [ch];
                     }
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
                chrome.serial.flush(connectionInfo.connectionId,
                                    flushComplete);
                function flushComplete() {
                    // This will be called once for each serial device that
                    // is successfully connected.
                    pendingDisplay = [];
                    if (document.getElementById("clear_on_restart").checked) {
                        document.getElementById("c").innerHTML = "";
                    }
                    if (!document.getElementById("ping_bootloader").checked)
                        return;
                    window.setTimeout(pingBootloader, bootloaderInitTime);
                }
                function pingBootloader() {
                    var pingBuffer = new ArrayBuffer(2);
                    var pingArrayView = new Uint8Array(pingBuffer);
                    pingArrayView.set([0x75, 0x20]);
                    chrome.serial.send(connectionInfo.connectionId,
                                       pingBuffer, ()=>{});
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

function restartViaDTROnly() {
    // The sequence here is:
    //   Drop DTR
    //   Wait 500ms
    //   Raise DTR
    //   Wait 2ms
    //   Flush input
    //   Clear screen or mark restart
    //   Wait for bootloaderInitTime
    //   Ping bootloader
    // If multiple connections are active, then most of these are done
    // in lockstep.  The reason is to make sure that the restart mark
    // is at a point in the output that is correct for all connections.
    
    // forEachConnection: call an asynchronous function with the
    // signature function(connectionId, callback).  This function is
    // called for each connection, then the callWhenFinished callback
    // is called.  This is similar to async.map.
    var currentConnections;
    function forEachConnection(callPerConnection, callWhenFinished) {
        var opsRemaining = currentConnections.length;
        for (var conn of currentConnections) {
            callPerConnection(conn.connectionId, doneOpCallback);
        }
        function doneOpCallback() {
            opsRemaining--;
            if (opsRemaining == 0)
                callWhenFinished();
        }
    }
    
    chrome.serial.getConnections(gotConnections);
    function gotConnections(connectionInfos) {
        currentConnections = connectionInfos;
        console.log("Restarting", connectionInfos.length, "devices");
        forEachConnection(dropConn, dropsDone);
    }
    function dropConn(connectionId, callback) {
        chrome.serial.setControlSignals(connectionId, {dtr:false}, callback);
    }
    function dropsDone() {
        // Dropping DTR doesn't actually stop the Arduino board from
        // running; it's just that raising DTR resets it.
        // If we were doing something V.24-compliant, we'd have to keep
        // DTR down for 500ms.  In our case, we really just need it down
        // long enough to discharge the reset capacitor (RC time constant
        // of 1ms on the Uno).  But we'll be nice in case things change
        // someday, and hold it down for 500ms.
        window.setTimeout(startRaising, 500);
    }
    function startRaising() {
        forEachConnection(raiseConn, raisesDone);
    }
    function raiseConn(connectionId, callback) {
        chrome.serial.setControlSignals(connectionId, {dtr:true}, callback);
    }
    function raisesDone() {
        // An important note: we haven't done anything to flush the
        // USB-Serial chip's internal buffers.  In fact, from what
        // I can tell, those never get flushed, even when there's not a
        // computer connected.  The LUFA library that the Uno uses
        // highly recommends watching DTR - see
        // http://www.fourwalledcubicle.com/files/LUFA/Doc/120730/html/group___group___u_s_b_class_c_d_c_device.html
        // but the Arduino code (on a non-FTDI board) doesn't do that.  Look at
        // https://github.com/arduino/Arduino/blob/master/hardware/arduino/avr/firmwares/atmegaxxu2/arduino-usbserial/Arduino-usbserial.c
        // Note that, in EVENT_CDC_Device_ControLineStateChanged, the only
        // thing that it does is to set the PD7 output pin to reflect DTR.
        // The code keeps running its main event loop.  The ring buffer
        // is never cleared, and CDC_Device_Flush is never called.
        //
        // That means we need to wait long enough for the Arduino's own
        // output buffer to drain.  Fortunately, we're guaranteed by the
        // bootloader that we have one second before anything is sent.
        // (The user code isn't running, and the bootloader doesn't initiate
        // anything.)
        //
        // The polling interval is 1ms, and the 128-byte silo can be
        // drained practically immediately.  So we'll just wait 2ms
        // for the data to drain.
        window.setTimeout(startFlushing, 2);
    }
    function startFlushing() {
        forEachConnection(chrome.serial.flush, flushesDone);
    }
    function flushesDone() {
        updateDisplay();
        if (document.getElementById("clear_on_restart").checked) {
            document.getElementById("c").innerHTML = "";
        } else {
            document.getElementById("c").innerHTML += "<hr />";
        }
        if (!document.getElementById("ping_bootloader").checked)
            return;
        // We actually could have folded the bootloaderInitTime wait into
        // the 2ms timeout above; it's separated here to clarify the
        // control flow.
        window.setTimeout(startPinging, bootloaderInitTime);
    }
    function startPinging() {
        forEachConnection(pingBootloader, bootloaderPingDone);
    }
    function pingBootloader(connId, callback) {
        var pingBuffer = new ArrayBuffer(2);
        var pingArrayView = new Uint8Array(pingBuffer);
        pingArrayView.set([0x75, 0x20]);
        chrome.serial.send(connId, pingBuffer, callback);
    }
    function bootloaderPingDone() {
    }
}

function restartClicked() {
    // There's two reasonable ways to restart: we toggle DTR, or we
    // disconnect and reconnect.  Toggling DTR means we don't drop any
    // data, but the other may be useful for experiments.
    restartViaDTROnly();
}

function init() {
    chrome.serial.onReceive.addListener(receiveHandler);
    chrome.serial.onReceiveError.addListener(receiveErrorHandler);
    document.getElementById("go").addEventListener('click', goClicked);
    document.getElementById("restart").addEventListener('click', restartClicked);
}
window.addEventListener('DOMContentLoaded', init);