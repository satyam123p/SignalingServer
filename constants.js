
import React, { useRef, useState, useEffect} from 'react';
const type = {
  ROOM_CREATE: {
      RESPONSE_FAILURE: "CHECK_ROOM_RESPONSE_FAILURE",
      RESPONSE_SUCCESS: "CHECK_ROOM_RESPONSE_SUCCESS", 
  },
  ROOM_DESTROY: {
      RESPONSE_FAILURE: "DESTROY_ROOM_RESPONSE_FAILURE",
      RESPONSE_SUCCESS: "DESTORY_ROOM_RESPONSE_SUCCESS", 
  },
  ROOM_JOIN: {
      RESPONSE_FAILURE: "JOIN_ROOM_RESPONSE_FAILURE",
      RESPONSE_SUCCESS: "JOIN_ROOM_RESPONSE_SUCCESS",
      REQUEST: "JOIN_ROOM_REQUEST",
      NOTIFY: "JOIN_ROOM_NOTIFY" 
  },
  ROOM_EXIT: {
      REQUEST: "EXIT_ROOM_REQUEST",
      NOTIFY: "EXIT_ROOM_NOTIFY" 
  },
  ROOM_DISONNECTION: {
      NOTIFY: "DISCONNECT_ROOM_NOTIFICATION"
  },
  WEB_RTC: {
      OFFER: "OFFER",
      ANSWER: "ANSWER",
      ICE_CANDIDATES: "ICE_CANDIDATES"
  }
};

const labels = {
  NORMAL_SERVER_PROCESS: "NORMAL_SERVER_PROCESS",
  WEBRTC_PROCESS: "WEBRTC_PROCESS"
};

const webRTCConfiguratons = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ],
};

const  App = () => {
  const [userId] = useState(Math.round(Math.random() * 1000000).toString());
  const [roomName, setRoomName] = useState(null);
  const [otherUserId, setOtherUserId] = useState(null);
  const [isJoined,setIsJoined]=useState(false);
  const [iceCandidatesGenerated, setIceCandidatesGenerated] = useState([]);
  const [iceCandidatesReceivedBuffer, setIceCandidatesReceivedBuffer] = useState([]);
  const [channelName, setChannelName] = useState('');
  const [message,setMessage]=useState('');
  const [answer,setAnswer]=useState(null);
  const [canISend,setCanISend]=useState(false);
  const [canISendIce,setCanISendIce]=useState(false);
  const pc = useRef(null);
  const dataChannel = useRef(null);
  const wsConnection = useRef(null);

  function handleClose() {
    console.log("You have been disconnected from our ws server");
  };
  function handleError() {
    console.log("An error was thrown while listening on onerror event on websocket");
  }
  useEffect(()=>{
    if(isJoined===true && roomName!==null && otherUserId!==null){
      startWebRTCProcess(); 
    }
  },[otherUserId,roomName,isJoined]);
  useEffect(()=>{
    console.log("IceCandidatesReceivedBuffer is updated.",iceCandidatesReceivedBuffer);
  },[iceCandidatesReceivedBuffer]);
  useEffect(() => {
    console.log('All ICE candidates so far:', iceCandidatesGenerated);
  }, [iceCandidatesGenerated]);
  useEffect(()=>{
    console.log("channleName is set");
  },[channelName]);
  useEffect(()=>{
    if(otherUserId!==null)
    console.log("otherUserId is:->",otherUserId);
  },[otherUserId]);
  useEffect(()=>{
    if(canISend===true){
      sendAnswer(answer);
    }
  },[canISend]);
  useEffect(()=>{
    if(canISendIce===true){
      console.log("Here is updated iceCandidatesGenerated array:-->",iceCandidatesGenerated);
      sendIceCandidates(iceCandidatesGenerated);
    }

  },[canISendIce])
  function joinSuccessHandler(data) {
    setOtherUserId(data.creatorId);
    setRoomName(data.roomName);
    setIsJoined(true);
}
function joinNotificationHandler(data) {
    alert(`User ${data.joinUserId} has joined your room`);
    setOtherUserId(data.joinUserId);
}
function updateUiForRemainingUser() {
  alert("a user has left your room");
  setOtherUserId(null);
}
function closePeerConnection() {
  if(pc.current) {
      pc.current.close();
      pc.current = null;
      dataChannel.current = null;
      console.log("You have closed your peer connection by calling the 'close()' method");
  }
}
function exitNotificationHandler(data) {
    updateUiForRemainingUser();
    closePeerConnection();
}
  function normalServerProcessing(data) {
    switch(data.type) {
        case type.ROOM_JOIN.RESPONSE_SUCCESS:
            joinSuccessHandler(data);
            alert("Join room successful");
            break; 
        case type.ROOM_JOIN.RESPONSE_FAILURE: 
            console.log("join room failed");
            break; 
        case type.ROOM_JOIN.NOTIFY: 
            joinNotificationHandler(data);
            break; 
        case type.ROOM_EXIT.NOTIFY:
            exitNotificationHandler(data);
            break;
        case type.ROOM_DISONNECTION.NOTIFY:
            exitNotificationHandler(data);
            break;
        default: 
            console.log("unknown data type: ", data.type);
    }
  };
  const startWebRTCProcess = async() => {
    createPeerConnectionObject();
    createDataChannel(true);
    const offer = await pc.current.createOffer();
    await pc.current?.setLocalDescription(offer);
    sendOffer(offer);
  }
  function createPeerConnectionObject() {
    pc.current = new RTCPeerConnection(webRTCConfiguratons);
    pc.current.onconnectionstatechange =  () => {
        console.log("connection state changed to: ", pc.current.connectionState); 
        if(pc.current.connectionState === "connected") {
            alert("YOU HAVE DONE IT! A WEBRTC CONNECTION HAS BEEN MADE BETWEEN YOU AND THE OTHER PEER");
        }
    };
    pc.current.onsignalingstatechange = () => {
        console.log(`Signaling state changed to: ${pc.current.signalingState}`);
    };
    pc.current.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('ICE:', e.candidate);
        setIceCandidatesGenerated((prev) => [...prev, e.candidate]);
      }
      else{
        setCanISendIce(true);
      }
    };
}
function createDataChannel(isOfferor) {
    if (isOfferor) {
        const dataChannelOptions = {
            ordered: false, 
            maxRetransmits: 0
        };
        dataChannel.current = pc.current.createDataChannel("top-secret-chat-room", dataChannelOptions);
        registerDataChannelEventListeners();
    } 
    else {
        pc.current.ondatachannel = (e) => {
            console.log('Data channel received:', e);
            dataChannel.current = e.channel;
            registerDataChannelEventListeners();
        }
    }
}
function registerDataChannelEventListeners() {
    dataChannel.current.onmessage =(e) => {
        console.log("message has been received from a Data Channel");
        const msg = e.data; 
        console.log(msg);
    };
    dataChannel.current.onclose = (e) => {
        console.log("The 'close' event was fired on your data channel object");
    };
    dataChannel.current.onopen = (e) => { 
        console.log("Data Channel has been opened. You are now ready to send/receive messsages over your Data Channel");
    };
}
function joinRoom(roomName, userId) {
  const message = {
      label: labels.NORMAL_SERVER_PROCESS,
      data: {
          type: type.ROOM_JOIN.REQUEST,
          roomName,
          userId
      }
  };
  wsConnection.current.send(JSON.stringify(message));
}
function exitRoom(roomName, userId) {
  const message = {
      label: labels.NORMAL_SERVER_PROCESS,
      data: {
          type: type.ROOM_EXIT.REQUEST,
          roomName,
          userId
      }
  };
  wsConnection.current.send(JSON.stringify(message));
}
function sendAnswer(answer) {
  console.log("Here i am sending answer to -->",otherUserId);
  const message = {
      label: labels.WEBRTC_PROCESS, 
      data: {
          type:type.WEB_RTC.ANSWER,
          answer, 
          otherUserId:otherUserId
      }
  }
  wsConnection.current.send(JSON.stringify(message));
};
  function sendOffer(offer) {
  const message = {
      label: labels.WEBRTC_PROCESS,
      data: {
          type: type.WEB_RTC.OFFER,
          offer, 
          otherUserId:otherUserId
      }
  }
  wsConnection.current.send(JSON.stringify(message));
  }
  function sendIceCandidates(arrayOfIceCandidates) {
    const message = {
        label:labels.WEBRTC_PROCESS,
        data: {
            type:type.WEB_RTC.ICE_CANDIDATES,
            candidatesArray: arrayOfIceCandidates,
            otherUserId: otherUserId
        }
    }
    wsConnection.current.send(JSON.stringify(message));
  }
  async function handleOffer(data) {
    createPeerConnectionObject(); 
    createDataChannel(false);
    await pc.current.setRemoteDescription(data.offer);
    let currentAnswer = await pc.current.createAnswer();
    await pc.current.setLocalDescription(currentAnswer);
    setAnswer(currentAnswer);
    setCanISend(true);
  }
  async function handleAnswer(data) {
    await pc.current.setRemoteDescription(data.answer);
    for (const candidate of iceCandidatesReceivedBuffer) {
      await pc.current.addIceCandidate(candidate);
    }; 
    setIceCandidatesReceivedBuffer([]);
  }
  function handleIceCandidates(data) {
      if(pc.current.remoteDescription) {
          try {
              data.candidatesArray.forEach(candidate => {
                  pc.current.addIceCandidate(candidate);
              });
          } 
          catch (error) {
              console.log("Error trying to add an ice candidate to the pc object", error);
          }
      } else {
        setIceCandidatesReceivedBuffer((prev) => [
          ...prev,
          ...data.candidatesArray.map((c) => c),
        ]);
      }   
  }
  function webRTCServerProcessing(data) {
    switch(data.type) {
        case type.WEB_RTC.OFFER:
            handleOffer(data);
            break;
        case type.WEB_RTC.ANSWER:
            handleAnswer(data);
            console.log("Answer is received here it is:-->",data.answer);
            break; 
        case type.WEB_RTC.ICE_CANDIDATES:
            console.log("Ice candidates are received from other peer.You can see them here--->",data);
            handleIceCandidates(data);
            break; 
        default: 
            console.log("Unknown data type: ", data.type);
    }
  };
  function handleMessage(incomingMessageEventObject){
    const message = JSON.parse(incomingMessageEventObject.data);
    console.log(message);
    switch(message.label) {
        case labels.NORMAL_SERVER_PROCESS:
            normalServerProcessing(message.data);
            break;
        case labels.WEBRTC_PROCESS:
            webRTCServerProcessing(message.data);
            break;
        default: 
            console.log("unknown server processing label: ", message.label);
    }
  };
  function registerSocketEvents() {
    wsConnection.current.onopen = () => {
        console.log("You have connected with our websocket server");
        wsConnection.current.onmessage = handleMessage;
        wsConnection.current.onclose = handleClose;
        wsConnection.current.onerror = handleError;
    };
  };

  function websockethandler(){
    console.log("Hello");
    wsConnection.current = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`);
    registerSocketEvents();
  }
  useEffect(()=>{
    console.log("RoomName is set.");
  },[roomName])
  function createRoom(roomName, userId){
    console.log("Here i have created roomName:->",roomName);

    fetch('http://10.0.2.2:8080/create-room', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }, 
        body: JSON.stringify({roomName, userId})
    })
    .then( response => response.json() )
    .then(resObj => {   
        if(resObj.data.type === type.ROOM_CREATE.RESPONSE_SUCCESS) {
            setRoomName(roomName);
            alert("Room created successfully.");
        }
        if(resObj.data.type === type.ROOM_CREATE.RESPONSE_FAILURE) {
            console.log("Create Room Failure->",resObj.data.message);
        }
    })
    .catch(err => {
        console.log("an error ocurred trying to create a room:-> ", err);
    })
}
function destroyRoom(roomName) {
    fetch('http://10.0.2.2:8080/destroy-room', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }, 
        body: JSON.stringify({roomName})
    })
    .then( response => response.json() )
    .then(resObj => {   
        if(resObj.data.type === type.ROOM_DESTROY.RESPONSE_SUCCESS) {
            setRoomName(null)
            setOtherUserId(null);
        }
        if(resObj.data.type === type.ROOM_DESTROY.RESPONSE_FAILURE) {
            console.log(resObj.data.message);
        }
    })
    .catch(err => {
        console.log("an error ocurred trying to destroy a room: ", err);
    })
  }
function handleSendMessage(message){
  dataChannel.current.send(message);
}
function handleExitRoom(){
  exitRoom(roomName, userId);
  setRoomName(null);
  setOtherUserId(null);
  closePeerConnection();
}
function handleJoinRoom(){
  if(!channelName) {
    return alert("You have to join a room with a valid name");
 }
  joinRoom(channelName, userId, wsConnection);
}
  return (
    <div >
        <div>WebRTC Chat Room (User ID: {userId})</div>
        <input
          type='text'
          placeholder="Enter room name"
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
        />
        {otherUserId !== null && <p>Other User ID: {otherUserId}</p>}
        <div>
          <button onClick={()=>createRoom(channelName,userId)}>
            <p>Create Room</p>
          </button>
          <button onClick={()=>destroyRoom(channelName)}>
            <p>Destroy Room</p>
          </button>
          <button  onClick={()=>handleJoinRoom(roomName)}>
            <p>Join Room</p>
          </button>
        </div>
        <div>
          <button onClick={()=>handleExitRoom()}>exit Room </button>
          <button onClick={()=>websockethandler()}>start websocket </button>
        </div>
        <input
          type='text'
          placeholder="Type a message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button onClick={()=>handleSendMessage(message)}>send</button>
    </div>
  );
};
export default App;













// import modules
import http from "http"; // native module
import express from "express";
import { WebSocketServer } from "ws";
import * as constants from "./constants.js";
import cors from "cors";
// define global variables
const connections = [
    // will contain objects containing {ws_connection, userId}
];
// define state for our rooms
const rooms = [
    // will contain objects containing {roomName, peer1, peer2}
];
// define a port for live and testing environments
const PORT = process.env.PORT || 8080;
// initilize the express application
const app = express();
// create an HTTP server, and pass our express application into our server
const server = http.createServer(app);
app.use(cors({ origin: '*' }));
// room creation via a POST request
app.post('/create-room', (req, res) => {
    // parse the body of the incoming request
    let body = "";
    req.on("data", chunk => {
        body += chunk.toString();
    })
    req.on("end", () => {
        // extract variables from our body
        const { roomName, userId } = JSON.parse(body);
        // check if room already exists
        const existingRoom = rooms.find(room => {
            return room.roomName === roomName;
        });
        if(existingRoom) {
            // a room of this name exists, and we need to send a failure message back to the client
            const failureMessage = {
                data: {
                    type: constants.type.ROOM_CREATE.RESPONSE_FAILURE,
                    message: "That room has already been created. Try another name, or join."
                }
            };
            res.status(400).json(failureMessage);
        } else {
            // the room does not already exist, so we have to add it to the rooms array
            rooms.push({
                roomName, 
                peer1: userId,
                peer2: null
            });
            console.log("Room created. Updated rooms array: ", rooms);
            // send a success message back to the client
            const successMessage = {
                data: {
                    type: constants.type.ROOM_CREATE.RESPONSE_SUCCESS
                }
            };
            res.status(200).json(successMessage);
        }
    });

}); // end CREATE ROOM
// destrying a room via a POST request
app.post('/destroy-room', (req, res) => {
    // parse the body of the incoming request
    let body = "";
    req.on("data", chunk => {
        body += chunk.toString();
    })
    req.on("end", () => {
        // extract variables from our body
        const { roomName } = JSON.parse(body);
        // check if room already exists
        const existingRoomIndex = rooms.findIndex(room => {
            return room.roomName === roomName;
        });
        if(existingRoomIndex !== -1) {
            // a room of this name exists, and we can remove it
            rooms.splice(existingRoomIndex, 1);
            const successMessage = {
                data: {
                    type: constants.type.ROOM_DESTROY.RESPONSE_SUCCESS,
                    message: "Room has been removed from the server."
                }
            };
            return res.status(200).json(successMessage);
        } else {
            const failureMessage = {
                data: {
                    type: constants.type.ROOM_DESTROY.RESPONSE_FAILURE,
                    message: "Server failed to find the room in the rooms array."
                }
            };
            return res.status(400).json(failureMessage);
        }
    });

}); // end DESTROYING ROOM
// ################################# WEBSOCKET SERVER SETUP
// mount our ws server onto our http server
const wss = new WebSocketServer({server});
// define a function thats called when a new connection is established
wss.on("connection", (ws, req) => handleConnection(ws, req));
function handleConnection(ws, req) {
    const userId = extractUserId(req);
    addConnection(ws, userId);
    // register all 3 event listeners
    ws.on("message", (data) => handleMessage(data));
    ws.on("close", () => handleDisconnection(userId));
    ws.on("error", () => console.log(`A WS error has occurred`));
};
function addConnection(ws, userId) {
    connections.push({
        wsConnection: ws, 
        userId
    });
    let message = "hello";
    ws.send(JSON.stringify(message));
    console.log("Total connected users: " + connections.length);
};
function extractUserId(req) {
    const queryParam = new URLSearchParams(req.url.split('?')[1]);
    return Number(queryParam.get("userId"));
};
function handleDisconnection(userId) {
    // Find the index of the connection associated with the user ID
    const connectionIndex = connections.findIndex(conn => conn.userId === userId);
    // If the user ID is not found in the connections array, log an error message and exit the function
    if(connectionIndex === -1) {
        console.log(`User: ${userId} not found in connections`);
        return; 
    };
    // Remove the user's connection from the active connections array
    connections.splice(connectionIndex, 1);
    // provide feedback
    console.log(`User: ${userId} removed from connections`);
    console.log(`Total connected users: ${connections.length}`);
    // removing rooms
    rooms.forEach(room => {
        // ternary operator to determine the ID of the other user which we'll use to send and notify the other user that this peer has left the room
        const otherUserId = (room.peer1 === userId) ? room.peer2 : room.peer1;
        // next, define the message to send the other user
        const notificationMessage = {
            label: constants.labels.NORMAL_SERVER_PROCESS,
            data: {
                type: constants.type.ROOM_DISONNECTION.NOTIFY,
                message: `User ${userId} has been disconnected`
            }
        };
        // push the message to the other user
        if(otherUserId) {
            sendWebSocketMessageToUser(otherUserId, notificationMessage);
        };
        // remove the user from the room
        if(room.peer1 === userId) {
            room.peer1 = null;
        } 
        if(room.peer2 === userId) {
            room.peer2 = null;
        }
        // clean up empty rooms
        if(room.peer1 === null && room.peer2 === null) {
            const roomIndex = rooms.findIndex(roomInArray => {
                return roomInArray.roomName === room.roomName;
            });

            if(roomIndex !== -1) {
                rooms.splice(roomIndex, 1);
                console.log(`Room ${room.roomName} has been removed as its empty`);
            }
        }
    });
};
function handleMessage(data) {
    try {
        let message = JSON.parse(data);
        console.log(message);
        // process message depending on its label type
        switch(message.label) {
            case constants.labels.NORMAL_SERVER_PROCESS:
                console.log("==== normal server message ====");
                normalServerProcessing(message.data);
                break;
            case constants.labels.WEBRTC_PROCESS:
                console.log("🐗 WEBRTC SIGNALING SERVER PROCESS 🐗");
                webRTCServerProcessing(message.data);
                break;
            default: 
                console.log("Unknown message label: ", message.label);
        }
    } catch (error) {
        console.log("Failed to parse message:", error);
        return;
    }
};
// >>>> NORMAL SERVER
function normalServerProcessing(data) {
    // process the request, depending on its data type
    switch(data.type) {
        case constants.type.ROOM_JOIN.REQUEST:
            joinRoomHandler(data);
            break;
        case constants.type.ROOM_EXIT.REQUEST:
            exitRoomHandler(data);
            break;
        default: 
            console.log("unknown data type: ", data.type);
    }
};  
function joinRoomHandler(data) {
    const { roomName, userId } = data; // Extract roomName and userId from the request
    // step 1: check if room exists
    const existingRoom = rooms.find(room => room.roomName === roomName);
    let otherUserId = null;
    if(!existingRoom) {
        console.log("A user tried to join, but the room does not exist");
        // send failure message
        const failureMessage = {
            label: constants.labels.NORMAL_SERVER_PROCESS,
            data: {
                type: constants.type.ROOM_JOIN.RESPONSE_FAILURE,
                message: "A room of that name does not exist. Either type another name, or create a room."
            }
        };
        // send a failure response back to the user
        sendWebSocketMessageToUser(userId, failureMessage);
        return; 
    };
    // step 2: check whether the room is full. 
    if(existingRoom.peer1 && existingRoom.peer2) {
        console.log("A user tried to join, but the room is full");
        // send failure message
        const failureMessage = {
            label: constants.labels.NORMAL_SERVER_PROCESS,
            data: {
                type: constants.type.ROOM_JOIN.RESPONSE_FAILURE,
                message: "This room already has two participants."
            }
        };
        sendWebSocketMessageToUser(userId, failureMessage);
        return;
    };
    // step 3: allow user to join a room
    // at this point, if our code executes here, the room is both available and exists
    console.log("A user is attempting to join a room");
    if(!existingRoom.peer1) {
        existingRoom.peer1 = userId;
        otherUserId = existingRoom.peer2;
        console.log(`added user ${userId} as peer1`);
    } else {
        existingRoom.peer2 = userId;
        otherUserId = existingRoom.peer1;
        console.log(`added user ${userId} as peer2`);
    };
    // send success message
    const successMessage = {
        label: constants.labels.NORMAL_SERVER_PROCESS,
        data: {
            type: constants.type.ROOM_JOIN.RESPONSE_SUCCESS,
            message: `you have successfully joined room ${existingRoom.roomName}`,
            creatorId: otherUserId,
            roomName: existingRoom.roomName
        }
    };
    sendWebSocketMessageToUser(userId, successMessage);
    // step 4: notify the other user that a peer has joined a room
    const notificationMessage = {
        label: constants.labels.NORMAL_SERVER_PROCESS,
        data: {
            type: constants.type.ROOM_JOIN.NOTIFY,
            message: `User ${userId} has joined your room`,
            joinUserId: userId
        }
    };
    sendWebSocketMessageToUser(otherUserId, notificationMessage);
    return;
}; // end JOINROOMHANDLER function
// logic to process a user exiting a room 
function exitRoomHandler(data) {
    const { roomName, userId } = data;
    const existingRoom = rooms.find(room => room.roomName === roomName);
    const otherUserId = (existingRoom.peer1 === userId) ? existingRoom.peer2 : existingRoom.peer1;
    if(!existingRoom) {
        console.log(`Room ${roomName} does not exist`);
        return;
    }
    // remove user from room
    if(existingRoom.peer1 === userId) {
        existingRoom.peer1 = null;
        console.log("removed peer1 from the rooms object: ", existingRoom);
    } else {
        existingRoom.peer2 = null; 
        console.log("removed peer2 from the rooms object: ", existingRoom);
    }
    // clean up and remove empty rooms
    if(existingRoom.peer1 === null && existingRoom.peer2 === null) {
        const roomIndex = rooms.findIndex(room => {
            return room.roomName === roomName;
        });
        if(roomIndex !== -1) {
            rooms.splice(roomIndex, 1);
            console.log(`Room ${roomName} has been removed as its empty`);
        }
        return;
    }
    // notify the other user that a peer has left a room
    const notificationMessage = {
        label: constants.labels.NORMAL_SERVER_PROCESS,
        data: {
            type: constants.type.ROOM_EXIT.NOTIFY,
            message: `User ${userId} has left the room. Another user can now join.`,
        }
    };
    sendWebSocketMessageToUser(otherUserId, notificationMessage);
    return;
};
// >>>> WEBRTC SERVER PROCESSING
function webRTCServerProcessing(data) {
    // process the WebRTC message, based on its type
    switch(data.type) {
        // OFFER
        case constants.type.WEB_RTC.OFFER:
            signalMessageToOtherUser(data);
            console.log(`Offer has been sent to user ${data.otherUserId}`);
            break; 
        // ANSWER
        case constants.type.WEB_RTC.ANSWER:
            signalMessageToOtherUser(data);
            console.log(`Answer has been sent to user ${data.otherUserId}`);
            break; 
        // ICE CANDIDATES
        case constants.type.WEB_RTC.ICE_CANDIDATES:
            signalMessageToOtherUser(data);
            console.log(`Ice candidates have been sent to user ${data.otherUserId}`);
            break; 
        // catch-all
        default: 
            console.log("Unknown data type: ", data.type);
    }
};  
function signalMessageToOtherUser(data) {
    const { otherUserId } = data; 
    const message = {
        label: constants.labels.WEBRTC_PROCESS,
        data: data
    };
    sendWebSocketMessageToUser(otherUserId, message);
};
// >>>> WEBSOCKET SERVER GENERIC FUNCTIONS
// send a message to a specific user
function sendWebSocketMessageToUser(sendToUserId, message) {
    const userConnection = connections.find(connObj => connObj.userId == sendToUserId);
    if(userConnection && userConnection.wsConnection) {
        console.log(sendToUserId,"---->",message);
        userConnection.wsConnection.send(JSON.stringify(message));
        console.log(`Message sent to ${sendToUserId}`);
    } else {
        console.log(`User ${sendToUserId} not found.`);
    };
};
// ################################# SPIN UP SERVER
server.listen(PORT, () => {
    console.log(`Server listening on port: ${PORT}`);
})





























import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
} from 'react-native-webrtc';

const type = {
  ROOM_CREATE: {
    RESPONSE_FAILURE: 'CHECK_ROOM_RESPONSE_FAILURE',
    RESPONSE_SUCCESS: 'CHECK_ROOM_RESPONSE_SUCCESS',
  },
  ROOM_DESTROY: {
    RESPONSE_FAILURE: 'DESTROY_ROOM_RESPONSE_FAILURE',
    RESPONSE_SUCCESS: 'DESTORY_ROOM_RESPONSE_SUCCESS',
  },
  ROOM_JOIN: {
    RESPONSE_FAILURE: 'JOIN_ROOM_RESPONSE_FAILURE',
    RESPONSE_SUCCESS: 'JOIN_ROOM_RESPONSE_SUCCESS',
    REQUEST: 'JOIN_ROOM_REQUEST',
    NOTIFY: 'JOIN_ROOM_NOTIFY',
  },
  ROOM_EXIT: {
    REQUEST: 'EXIT_ROOM_REQUEST',
    NOTIFY: 'EXIT_ROOM_NOTIFY',
  },
  ROOM_DISONNECTION: {
    NOTIFY: 'DISCONNECT_ROOM_NOTIFICATION',
  },
  WEB_RTC: {
    OFFER: 'OFFER',
    ANSWER: 'ANSWER',
    ICE_CANDIDATES: 'ICE_CANDIDATES',
  },
};

const labels = {
  NORMAL_SERVER_PROCESS: 'NORMAL_SERVER_PROCESS',
  WEBRTC_PROCESS: 'WEBRTC_PROCESS',
};

const webRTCConfiguratons = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ],
};

const App = () => {
  const [userId] = useState(Math.round(Math.random() * 1000000).toString());
  const [roomName, setRoomName] = useState(null);
  const [otherUserId, setOtherUserId] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  const [iceCandidatesGenerated, setIceCandidatesGenerated] = useState([]);
  const [iceCandidatesReceivedBuffer, setIceCandidatesReceivedBuffer] = useState(
    []
  );
  const [channelName, setChannelName] = useState('');
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState(null);
  const [canISend, setCanISend] = useState(false);
  const [canISendIce, setCanISendIce] = useState(false);
  const pc = useRef(null);
  const dataChannel = useRef(null);
  const wsConnection = useRef(null);

  function handleClose() {
    console.log('You have been disconnected from our ws server');
  }

  function handleError() {
    console.log(
      'An error was thrown while listening on onerror event on websocket'
    );
  }

  useEffect(() => {
    if (isJoined === true && roomName !== null && otherUserId !== null) {
      startWebRTCProcess();
    }
  }, [otherUserId, roomName, isJoined]);

  useEffect(() => {
    console.log('IceCandidatesReceivedBuffer is updated.', iceCandidatesReceivedBuffer);
  }, [iceCandidatesReceivedBuffer]);

  useEffect(() => {
    console.log('All ICE candidates so far:', iceCandidatesGenerated);
  }, [iceCandidatesGenerated]);

  useEffect(() => {
    console.log('channleName is set');
  }, [channelName]);

  useEffect(() => {
    if (otherUserId !== null)
      console.log('otherUserId is:->', otherUserId);
  }, [otherUserId]);

  useEffect(() => {
    if (canISend === true) {
      sendAnswer(answer);
    }
  }, [canISend]);

  useEffect(() => {
    if (canISendIce === true) {
      console.log('Here is updated iceCandidatesGenerated array:-->', iceCandidatesGenerated);
      sendIceCandidates(iceCandidatesGenerated);
    }
  }, [canISendIce]);

  function joinSuccessHandler(data) {
    setOtherUserId(data.creatorId);
    setRoomName(data.roomName);
    setIsJoined(true);
  }

  function joinNotificationHandler(data) {
    Alert.alert(`User ${data.joinUserId} has joined your room`);
    setOtherUserId(data.joinUserId);
  }

  function updateUiForRemainingUser() {
    Alert.alert('A user has left your room');
    setOtherUserId(null);
  }

  function closePeerConnection() {
    if (pc.current) {
      pc.current.close();
      pc.current = null;
      dataChannel.current = null;
      console.log("You have closed your peer connection by calling the 'close()' method");
    }
  }

  function exitNotificationHandler(data) {
    updateUiForRemainingUser();
    closePeerConnection();
  }

  function normalServerProcessing(data) {
    switch (data.type) {
      case type.ROOM_JOIN.RESPONSE_SUCCESS:
        joinSuccessHandler(data);
        Alert.alert('Join room successful');
        break;
      case type.ROOM_JOIN.RESPONSE_FAILURE:
        console.log('join room failed');
        break;
      case type.ROOM_JOIN.NOTIFY:
        joinNotificationHandler(data);
        break;
      case type.ROOM_EXIT.NOTIFY:
        exitNotificationHandler(data);
        break;
      case type.ROOM_DISONNECTION.NOTIFY:
        exitNotificationHandler(data);
        break;
      default:
        console.log('unknown data type: ', data.type);
    }
  }

  const startWebRTCProcess = async () => {
    createPeerConnectionObject();
    createDataChannel(true);
    const offer = await pc.current.createOffer();
    await pc.current?.setLocalDescription(new RTCSessionDescription(offer));
    sendOffer(offer);
  };

  function createPeerConnectionObject() {
    pc.current = new RTCPeerConnection(webRTCConfiguratons);
    pc.current.onconnectionstatechange = () => {
      console.log('connection state changed to: ', pc.current.connectionState);
      if (pc.current.connectionState === 'connected') {
        Alert.alert(
          'YOU HAVE DONE IT! A WEBRTC CONNECTION HAS BEEN MADE BETWEEN YOU AND THE OTHER PEER'
        );
      }
    };
    pc.current.onsignalingstatechange = () => {
      console.log(`Signaling state changed to: ${pc.current.signalingState}`);
    };
    pc.current.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('ICE:', e.candidate);
        setIceCandidatesGenerated((prev) => [...prev, e.candidate]);
      } else {
        setCanISendIce(true);
      }
    };
  }

  function createDataChannel(isOfferor) {
    if (isOfferor) {
      const dataChannelOptions = {
        ordered: false,
        maxRetransmits: 0,
      };
      dataChannel.current = pc.current.createDataChannel(
        'top-secret-chat-room',
        dataChannelOptions
      );
      registerDataChannelEventListeners();
    } else {
      pc.current.ondatachannel = (e) => {
        console.log('Data channel received:', e);
        dataChannel.current = e.channel;
        registerDataChannelEventListeners();
      };
    }
  }

  function registerDataChannelEventListeners() {
    dataChannel.current.onmessage = (e) => {
      console.log('message has been received from a Data Channel');
      const msg = e.data;
      console.log(msg);
    };
    dataChannel.current.onclose = (e) => {
      console.log("The 'close' event was fired on your data channel object");
    };
    dataChannel.current.onopen = (e) => {
      console.log(
        'Data Channel has been opened. You are now ready to send/receive messsages over your Data Channel'
      );
    };
  }

  function joinRoom(roomName, userId) {
    const message = {
      label: labels.NORMAL_SERVER_PROCESS,
      data: {
        type: type.ROOM_JOIN.RESPONSE_SUCCESS,
        roomName,
        userId,
      },
    };
    wsConnection.current.send(JSON.stringify(message));
  }

  function exitRoom(roomName, userId) {
    const message = {
      label: labels.NORMAL_SERVER_PROCESS,
      data: {
        type: type.ROOM_EXIT.REQUEST,
        roomName,
        userId,
      },
    };
    wsConnection.current.send(JSON.stringify(message));
  }

  function sendAnswer(answer) {
    console.log('Here i am sending answer to -->', otherUserId);
    const message = {
      label: labels.WEBRTC_PROCESS,
      data: {
        type: type.WEB_RTC.ANSWER,
        answer,
        otherUserId: otherUserId,
      },
    };
    wsConnection.current.send(JSON.stringify(message));
  }

  function sendOffer(offer) {
    const message = {
      label: labels.WEBRTC_PROCESS,
      data: {
        type: type.WEB_RTC.OFFER,
        offer,
        otherUserId: otherUserId,
      },
    };
    wsConnection.current.send(JSON.stringify(message));
  }

  function sendIceCandidates(arrayOfIceCandidates) {
    const message = {
      label: labels.WEBRTC_PROCESS,
      data: {
        type: type.WEB_RTC.ICE_CANDIDATES,
        candidatesArray: arrayOfIceCandidates,
        otherUserId: otherUserId,
      },
    };
    wsConnection.current.send(JSON.stringify(message));
  }

  async function handleOffer(data) {
    createPeerConnectionObject();
    createDataChannel(false);
    await pc.current.setRemoteDescription(new RTCSessionDescription(data.offer));
    let currentAnswer = await pc.current.createAnswer();
    await pc.current.setLocalDescription(new RTCSessionDescription(currentAnswer));
    setAnswer(currentAnswer);
    setCanISend(true);
  }

  async function handleAnswer(data) {
    await pc.current.setRemoteDescription(new RTCSessionDescription(data.answer));
    for (const candidate of iceCandidatesReceivedBuffer) {
      await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
    }
    setIceCandidatesReceivedBuffer([]);
  }

  function handleIceCandidates(data) {
    if (pc.current.remoteDescription) {
      try {
        data.candidatesArray.forEach((candidate) => {
          pc.current.addIceCandidate(new RTCIceCandidate(candidate));
        });
      } catch (error) {
        console.log('Error trying to add an ice candidate to the pc object', error);
      }
    } else {
      setIceCandidatesReceivedBuffer((prev) => [
        ...prev,
        ...data.candidatesArray.map((c) => c),
      ]);
    }
  }

  function webRTCServerProcessing(data) {
    switch (data.type) {
      case type.WEB_RTC.OFFER:
        handleOffer(data);
        break;
      case type.WEB_RTC.ANSWER:
        handleAnswer(data);
        console.log('Answer is received here it is:-->', data.answer);
        break;
      case type.WEB_RTC.ICE_CANDIDATES:
        console.log(
          'Ice candidates are received from other peer.You can see them here--->',
          data
        );
        handleIceCandidates(data);
        break;
      default:
        console.log('Unknown data type: ', data.type);
    }
  }

  function handleMessage(incomingMessageEventObject) {
    const message = JSON.parse(incomingMessageEventObject.data);
    console.log(message);
    switch (message.label) {
      case labels.NORMAL_SERVER_PROCESS:
        normalServerProcessing(message.data);
        break;
      case labels.WEBRTC_PROCESS:
        webRTCServerProcessing(message.data);
        break;
      default:
        console.log('unknown server processing label: ', message.label);
    }
  }

  function registerSocketEvents() {
    wsConnection.current.onopen = () => {
      console.log('You have connected with our websocket server');
      wsConnection.current.onmessage = handleMessage;
      wsConnection.current.onclose = handleClose;
      wsConnection.current.onerror = handleError;
    };
  }

  function websockethandler() {
    console.log('Hello');
    wsConnection.current = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`); // Use 10.0.2.2 for Android emulator
    registerSocketEvents();
  }

  useEffect(() => {
    console.log('RoomName is set.');
  }, [roomName]);

  function createRoom(roomName, userId) {
    console.log('Here i have created roomName:->', roomName);
    fetch('http://10.0.2.2:8080/create-room', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomName, userId }),
    })
      .then((response) => response.json())
      .then((resObj) => {
        if (resObj.data.type === type.ROOM_CREATE.RESPONSE_SUCCESS) {
          setRoomName(roomName);
          Alert.alert('Room created successfully.');
        }
        if (resObj.data.type === type.ROOM_CREATE.RESPONSE_FAILURE) {
          console.log('Create Room Failure->', resObj.data.message);
        }
      })
      .catch((err) => {
        console.log('an error ocurred trying to create a room:-> ', err);
      });
  }

  function destroyRoom(roomName) {
    fetch('http://10.0.2.2:8080/destroy-room', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomName }),
    })
      .then((response) => response.json())
      .then((resObj) => {
        if (resObj.data.type === type.ROOM_DESTROY.RESPONSE_SUCCESS) {
          setRoomName(null);
          setOtherUserId(null);
        }
        if (resObj.data.type === type.ROOM_DESTROY.RESPONSE_FAILURE) {
          console.log(resObj.data.message);
        }
      })
      .catch((err) => {
        console.log('an error ocurred trying to destroy a room: ', err);
      });
  }

  function handleSendMessage(message) {
    dataChannel.current.send(message);
  }

  function handleExitRoom() {
    exitRoom(roomName, userId);
    setRoomName(null);
    setOtherUserId(null);
    closePeerConnection();
  }

  function handleJoinRoom() {
    if (!channelName) {
      return Alert.alert('You have to join a room with a valid name');
    }
    joinRoom(channelName, userId);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WebRTC Chat Room (User ID: {userId})</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter room name"
        value={channelName}
        onChangeText={setChannelName}
      />
      {otherUserId !== null && (
        <Text style={styles.text}>Other User ID: {otherUserId}</Text>
      )}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => createRoom(channelName, userId)}
        >
          <Text style={styles.buttonText}>Create Room</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={() => destroyRoom(channelName)}
        >
          <Text style={styles.buttonText}>Destroy Room</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={() => handleJoinRoom(roomName)}
        >
          <Text style={styles.buttonText}>Join Room</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={() => handleExitRoom()}>
          <Text style={styles.buttonText}>Exit Room</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => websockethandler()}>
          <Text style={styles.buttonText}>Start WebSocket</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        placeholder="Type a message..."
        value={message}
        onChangeText={setMessage}
      />
      <TouchableOpacity
        style={styles.button}
        onPress={() => handleSendMessage(message)}
      >
        <Text style={styles.buttonText}>Send</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    marginBottom: 10,
    borderRadius: 5,
  },
  text: {
    fontSize: 16,
    marginBottom: 10,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
    flex: 1,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
});

export default App;
