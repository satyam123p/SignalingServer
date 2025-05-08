# WebRTC Connection Setup Task List
*Skill Level:* Intermediate - Advanced

This document outlines the steps required to establish a WebRTC connection between two clients (PEER1 and PEER2) using signaling via a Node.js WebSocket server.

## Stage 1: 🙍‍♂️ PEER1 Sets Up WebRTC and Sends Offer
- **Role**: You can refer to PEER1 as the Initiator/Caller/Offeror. These steps involve the user and their browser preparing to establish a WebRTC connection.

### 1. Configure STUN (or TURN if applicable) Servers
- **Note**: The `RTCPeerConnection` requires STUN servers for NAT traversal in real-world applications. You do this by specifing configuration options for your RTCPeerConnection.
- **Purpose**: ICE candidates will be needed to help PEER2 locate PEER1.
- **Remember 💡**: An `ICE Candidate` is just a fancy word for a "possible route to your browser window".

### 2. Create RTCPeerConnection
- **Action**: PEER1 creates an instance of `RTCPeerConnection` on their browser. This instance is necessary to generate the offer that will be sent to PEER2 via the signaling server. 
- **Details**: Not only do we create an instance of the `RTCPeerConnection' object, but we also need to register event listeners
- **Remember 💡**: The `RTCPeerConnection` manages the entire connection between PEER1 and PEER2.

### 3. Define Data to Send/Receive
- **Action**: PEER1 must determine what data it will allow to be sent and received (e.g., PEER1 will call `getUserMedia()` if PEER1 wants to send/receive video and audio). In our project, we will use our peer connection to create a Data Channel by calling `pc.createDataChannel()`

### 4. Add Data to the RTCPeerConnection
- **Action**: PEER1 adds the data (a data channel in our case, but could also be a video stream and audio track) to its `RTCPeerConnection`.
- **Purpose**: This action associates PEER1's data with their `RTCPeerConnection`.
- **Important ❗**: Your application has not yet started to gather ICE candidates. In our project, by calling `pc.createDataChannel()`, this step has been done automatically

### 5. PEER1 Creates an Offer
- **Action**: PEER1 creates an offer using its `RTCPeerConnection` that has our data channel.
- **Details**:
  - The offer is of type `RTCSessionDescription`, which contains two parts:
    - **SDP**: Contains information about the data to be exchanged (here a simple data channel).
    - **Type**: Designated as "offer" indicating that PEER1 initiated the WebRTC connection.

### 6. Set Local Description
- **Action**: Offer is floating in space. So PEER1 assigns the generated offer to the `RTCPeerConnection` using the `setLocalDescription()` method.

### 7. Collect ICE Candidates 
- **Note**: When `setLocalDescription()` is executed, your browser will start to gather ICE candidates and will return them to PEER1, asynchronously.

### 8. PEER1 Sends "Offer" to Signaling Server
- **Action**: PEER1 sends the offer to our ws signaling server. 
- **Details**:
  - Our signaling server will forward the offer to PEER2.
  - The offer must be associated with PEER1.

### 9. PEER1 Sends ICE Candidates to Signaling Server
- **Action**: Once ICE candidates become available, PEER1 sends them to signaling server.
- **Details**:
  - The signaling server will relay these ICE candidates (routes) to PEER2.
  - Each ICE candidate will be associated with PEER1.
  - **Important ❗**: For learning purposes, I've created buttons and we will only send ice candidates at the end, after PEER1 has recevied an answer from PEER2. However, in the real world they will be sent on a "trickle" basis.

## Stage 2: 📶📶📶 Signaling Server
Our WebSocket signaling server is now used to facilitate communication between both peers.
### 10. Signaling Server sends Offer to PEER2

## Stage 3: 👨‍🦰 PEER2 sets up WebRTC and Sends Answer
- **Role**: You can refer to PEER2 as the Calleee/Offeree.

### 11. PEER2 Loads Webpage
- **Action**: PEER2 loads the webpage and establishes a WebSocket connection with our signaling server, triggering a "connection" event. 
- **Purpose**: To establish a connection with our WebSocket signaling server.

### 12. PEER2 Receives Offer
- **Action**: PEER2 receives the RTCSessionDescription (offer) pushed to it by our signaling server.

### 13. Configure STUN Servers
- **Note**: PEER2's `RTCPeerConnection` requires STUN servers for NAT traversal in real-world applications.
- **Purpose**: ICE candidates are needed to help PEER1 locate PEER2.

### 14. Create RTCPeerConnection
- **Action**: PEER2 creates their own instance of the `RTCPeerConnection`. This instance is necessary for generating an `answer` that our signaling server can send back to PEER1.

### 15. Decides on the Data for Sending and Receiving
- **Action**: PEER2 must also decide what data it wishes to send and receive. 
  - **Important ❗**: In a WebRTC connection, each peer can independently decide what types of data to send and receive.

### 16. Add data types to RTCPeerConnection
- **Action**: PEER2 registers a listener for the data channel (or adds media tracks if you're using video/audio calls) to its `RTCPeerConnection`.
- **Purpose**: This action associates PEER2's media data with the `RTCPeerConnection`.

### 17. Set Remote Description
- **Action**: After receiving the offer, PEER2 can set the remote description via the `RTCPeerConnection.setRemoteDescription()` method.
- **Details**:
  - The `setRemoteDescription()` method informs the WebRTC connection (managed by the `RTCPeerConnection` interface) about the configuration proposed by the other peer (in this case, PEER1)
  - Without this information, PEER2 would not know the data type proposed by PEER2

### 18. PEER2 Creates an Answer
- **Action**: PEER2 creates an answer using `createAnswer()`.
- **Details**:
  - The answer is of type `RTCSessionDescription`, which contains two parts:
    - **SDP**: Contains information about the data it will allow to be exchanged.
    - **Type**: Designated as "answer," indicating that this description responds to an offer.

### 19. Set Local Description
- **Action**: PEER2 assigns the generated answer to the `RTCPeerConnection` using the `setLocalDescription()` method, indicating that it is preparing a local answer.

### 20. Collect ICE Candidates
- **Note**: When `setLocalDescription()` is executed by PEER2, ICE candidates will be automatically generated and returned to PEER2 asynchronously. For our project, we are pushing all ice candidates into an array.

### 21. PEER2 Sends "Answer" to signaling Server
- **Action**: PEER2 sends the answer (of type `RTCSessionDescription`) to the signaling server.
- **Details**:
  - Our signaling server must then relay this answer back to PEER1.

### 22. PEER2 Sends ICE Candidates to Signaling Server
- **Action**: Once ICE candidates become available, PEER2 sends them to signaling server.
- **Details**:
  - The signaling server will relay these ICE candidates (routes) to PEER1.
  - Each ICE candidate will be associated with PEER2.
  - **Important ❗**: For learning purposes, I've created buttons and we will only send ice candidates immediately after PEER2 has generated and sent its answer. However, in the real world they will be sent on a trickle basis.

## Stage 4: 📶📶📶 Signaling Server
### 23. Signaling Server sends Answer (and ice candidates) to PEER1

## Stage 5: 🙍‍♂️ PEER1 Receives Answer

### 24. Peer1 receives the answer and ice candidates
- **Action**: PEER1 receives an answer from the signaling server, and pushes ice candidates into a temp buffer.

### 25. Peer1 sends ICE Candidates to signaling server
- **Action**: PEER1 sends all of its ice candidates back to PEER2 via the signaling server. 
- **Details**:
  - The signaling server will relay these candidates (routes) back to PEER2. In real life this will happen asynchronously.

### 26. Peer1 Sets Remote Description
- **Action**: PEER1 has to now register the WebRTC "answer" from PEER2 with its own instance of `RTCPeerConnection` by calling `setRemoteDescription()`.

## Final Comments

### Listening for ICE Candidates
- **Note**:
  - After each peer has successfully exchanged `RTCSessionDescription` control messages, they must wait for the arrival of ICE candidates.
  - Neither peer can send data until they have received relevant ICE candidates from each other
  - For the iceconnectionstatechange to be in the "connected" state, the local and remote session descriptions needs to be fully completed
  - It is possible for PEER1 to fire the "connected" event before PEER2, and visa versa. 
  - However, for PEER1 to send data over a data channel, the 'onopen' event needs to fire first. 
  - BOTTOM LINE: Once both peers have exchanged ICE candidates, they can establish a fully functional connection and begin sending/receiving data in compliance with their `RTCPeerConnection`.

### Conclusion
- **Summary**:
  - At this point, both peers have completed all necessary setup steps, including exchanging offers, answers, and ICE candidates.
  - A successful WebRTC connection has been established, enabling real-time communication between PEER1 and PEER2!
  - CELEBRATE 🥤
  - 








// import React, { useRef, useState, useEffect } from 'react';
// import {
//   View,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   Alert,
// } from 'react-native';
// import {
//   RTCPeerConnection,
//   RTCIceCandidate,
// } from 'react-native-webrtc';
// const App = () => {
//   const [userId] = useState(Math.round(Math.random() * 1000000).toString());
//   const [roomName, setRoomName] = useState(null);
//   const [otherUserId, setOtherUserId] = useState(null);
//   const [isJoined, setIsJoined] = useState(false);
//   const [iceCandidatesGenerated, setIceCandidatesGenerated] = useState([]);
//   const [iceCandidatesReceivedBuffer, setIceCandidatesReceivedBuffer] = useState([]);
//   const [channelName, setChannelName] = useState('');
//   const [message, setMessage] = useState('');
//   const [answer, setAnswer] = useState(null);
//   const [canISend, setCanISend] = useState(false);
//   const [canISendIce, setCanISendIce] = useState(false);
//   const pc = useRef(null);
//   const dataChannel = useRef(null);
//   const wsConnection = useRef(null);
//   useEffect(() => {
//     if(isJoined===true){
//       startWebRTCProcess();
//     }
//   },[isJoined]);
//   useEffect(() => {
//     if (canISend === true) {
//       sendAnswer(answer);
//     }
//   }, [canISend]);
//   useEffect(() => {
//     if (canISendIce === true) {
//       sendIceCandidates(iceCandidatesGenerated);
//     }
//   }, [canISendIce]);
//   function createPeerConnectionObject() {
//     pc.current = new RTCPeerConnection({
//       iceServers:[
//       {
//         urls: [
//           'stun:stun.l.google.com:19302',
//           'stun:stun2.l.google.com:19302',
//           'stun:stun3.l.google.com:19302',
//           'stun:stun4.l.google.com:19302',
//         ],
//       },
//     ]});
//     pc.current.onconnectionstatechange = () => {
//       console.log('connection state changed to: ', pc.current.connectionState);
//       if (pc.current.connectionState === 'connected') {
//         Alert.alert(
//           'YOU HAVE DONE IT! A WEBRTC CONNECTION HAS BEEN MADE BETWEEN YOU AND THE OTHER PEER'
//         );
//       }
//     };
//     pc.current.onsignalingstatechange = () => {
//       console.log(`Signaling state changed to: ${pc.current.signalingState}`);
//     };
//     pc.current.onicecandidate = (e) => {
//       if (e.candidate) {
//         console.log('ICE:', e.candidate);
//         setIceCandidatesGenerated((prev) => [...prev, e.candidate]);
//       }else {
//         setCanISendIce(true);
//       }
//     };
//   }
//   function createDataChannel(isOfferor) {
//     if (isOfferor) {
//       dataChannel.current = pc.current.createDataChannel('top-secret-chat-room');
//     } 
//     else {
//       pc.current.ondatachannel = (e) => {
//         dataChannel.current = e.channel;
//       };
//     }
//     dataChannel.current.onmessage = (e) => {
//       console.log('message has been received from a Data Channel');
//       const msg = e.data;
//       console.log(msg);
//     };
//     dataChannel.current.onclose = (e) => {
//       console.log("The 'close' event was fired on your data channel object");
//     };
//     dataChannel.current.onopen = () => {
//       console.log(
//         'Data Channel has been opened. You are now ready to send/receive messsages over your Data Channel'
//       );
//     };
//   }
//   function joinRoom(roomName, userId) {
//     const message = {
//       label: 'NORMAL_SERVER_PROCESS',
//       data: {
//         type: "JOIN_ROOM_REQUEST",
//         roomName,
//         userId,
//       },
//     };
//     wsConnection.current.send(JSON.stringify(message));
//   }

//   function sendAnswer(answer) {
//     const message = {
//       label:'WEBRTC_PROCESS',
//       data: {
//         type: "ANSWER",
//         answer,
//         otherUserId: otherUserId,
//       },
//     };
//     wsConnection.current.send(JSON.stringify(message));
//   }
//   function sendOffer(offer) {
//     const message = {
//       label: 'WEBRTC_PROCESS',
//       data: {
//         type: 'OFFER',
//         offer,
//         otherUserId: otherUserId,
//       },
//     };
//     wsConnection.current.send(JSON.stringify(message));
//   }
//   function sendIceCandidates(arrayOfIceCandidates) {
//     const message = {
//       label: 'WEBRTC_PROCESS',
//       data: {
//         type: "ICE_CANDIDATES",
//         candidatesArray: arrayOfIceCandidates,
//         otherUserId: otherUserId,
//       },
//     };
//     wsConnection.current.send(JSON.stringify(message));
//   }
//   async function handleOffer(data) {
//     createPeerConnectionObject();
//     createDataChannel(false);
//     await pc.current.setRemoteDescription(data.offer);
//     let currentAnswer = await pc.current.createAnswer();
//     await pc.current.setLocalDescription(currentAnswer);
//     setAnswer(currentAnswer);
//     setCanISend(true);
//   }
//   async function handleAnswer(data) {
//     await pc.current.setRemoteDescription(data.answer);
//     for (const candidate of iceCandidatesReceivedBuffer) {
//       await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
//     }
//     setIceCandidatesReceivedBuffer([]);
//   }
//   async function startWebRTCProcess (){
//     createPeerConnectionObject();
//     const offer = await pc.current.createOffer();
//     console.log(offer);
//     await pc.current.setLocalDescription(offer);
//     console.log("Here is Pc after setting local description:-->",pc.current);
//     createDataChannel(true);
//     sendOffer(offer);
//   };
//   function handleIceCandidates(data) {
//     if (pc.current.remoteDescription) {
//       try {
//         data.candidatesArray.forEach((candidate) => {
//           pc.current.addIceCandidate(new RTCIceCandidate(candidate));
//         });
//       } catch (error) {
//         console.log('Error trying to add an ice candidate to the pc object', error);
//       }
//     } else {
//       setIceCandidatesReceivedBuffer((prev) => [
//         ...prev,
//         ...data.candidatesArray.map((c) => c),
//       ]);
//     }
//   }
//   function websockethandler() {
//     wsConnection.current = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`);
//     wsConnection.current.onopen = () => {
//       console.log('You have connected with our websocket server');
//       wsConnection.current.onmessage =(incomingMessageEventObject)=>{
//         const message = JSON.parse(incomingMessageEventObject.data);
//         if(message.label=='NORMAL_SERVER_PROCESS'){
//           if(message.data.type=='JOIN_ROOM_RESPONSE_SUCCESS'){
//             setOtherUserId(message.data.creatorId);
//             setRoomName(message.data.roomName);
//             setIsJoined(true);
//             console.log('Join room successful');
//           }
//           else if(message.data.type=='JOIN_ROOM_NOTIFY'){
//             console.log(`User ${message.data.joinUserId} has joined your room`);
//             setOtherUserId(message.data.joinUserId);
//           }
//         }
//         else{
//           if(message.data.type=='OFFER'){
//             handleOffer(message.data);
//           }
//           else if(message.data.type=='ANSWER'){
//             handleAnswer(message.data);
//           }
//           else{
//             handleIceCandidates(message.data);
//           }
//         }
//       }
//       wsConnection.current.onclose = ()=> console.log('You have been disconnected from our ws server');
//       wsConnection.current.onerror = ()=>console.log("Some sort of error occured");
//     };
//   }
//   async function createRoom(roomName, userId) {
//     try{
//       let res = await fetch('http://10.0.2.2:8080/create-room', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({roomName, userId}),
//       })
//       let resObj = await res.json();
//       if (resObj.data.type === 'CHECK_ROOM_RESPONSE_SUCCESS') {
//         setRoomName(roomName);
//         console.log('Room created successfully.');
//       }else{
//         console.log("Room is not created successfully.");
//       }
//     }catch(error){
//       console.log("Some sort of error has been occured:->",error);
//     }
//   }
//   return (
//     <View>
//       <Text>WebRTC Chat Room (User ID: {userId})</Text>
//       <TextInput
//         placeholder="Enter room name"
//         value={channelName}
//         onChangeText={setChannelName}
//       />
//       <View>
//         <TouchableOpacity onPress={() => createRoom(channelName, userId)}><Text>Create Room</Text></TouchableOpacity>
//         <TouchableOpacity onPress={() => joinRoom(channelName, userId)}><Text>Join Room</Text></TouchableOpacity>
//         <TouchableOpacity onPress={() => websockethandler()}><Text>Start WebSocket</Text></TouchableOpacity>
//       </View>
//       <TextInput
//         placeholder="Type a message..."
//         value={message}
//         onChangeText={setMessage}
//       />
//       <TouchableOpacity onPress={() => dataChannel.current.send(message) }><Text>Send</Text></TouchableOpacity>
//     </View>
//   );
// };
// export default App;





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
  setLocalDescription,
  setRemoteDescription
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
  }, [isJoined]);

  useEffect(() => {
    console.log("iceCandidateReceivedBuffer:--->",iceCandidatesReceivedBuffer);
    if(iceCandidatesReceivedBuffer.length>0) console.log('IceCandidatesReceivedBuffer is updated.', iceCandidatesReceivedBuffer);
  }, [iceCandidatesReceivedBuffer]);

  useEffect(() => {
    console.log("iceCandidateGenerated:-->",iceCandidatesGenerated);
    if(iceCandidatesGenerated.length>0) console.log('All ICE candidates so far:', iceCandidatesGenerated);
  }, [iceCandidatesGenerated]);

  useEffect(() => {
    if (canISend === true) {
      console.log("Here i am sending answer.");
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
    const offer = await pc.current.createOffer();
    await pc.current.setLocalDescription(offer);
    createDataChannel(true);
    console.log("Here is reaching here",pc.current);
    sendOffer(offer);
  };
  function createPeerConnectionObject() {
    pc.current = new RTCPeerConnection(webRTCConfiguratons);
    console.log(pc.current);
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
      console.log("Here ice candidate will generate.");
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
        maxRetransmits: 0
    };
      dataChannel.current = pc.current.createDataChannel(
        'top-secret-chat-room',
        dataChannelOptions
      );
      console.log("Here is datachannel--:",dataChannel.current);
      console.log("Here i am creating dataChannel:----->",dataChannel);
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
        type: type.ROOM_JOIN.REQUEST,
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
    console.log("I am getting offer here.");
    createPeerConnectionObject();
    createDataChannel(false);
    await pc.current.setRemoteDescription(data.offer);
    let currentAnswer = await pc.current.createAnswer();
    console.log("Here i am setting localDescription.");
    await pc.current.setLocalDescription(currentAnswer);
    console.log("Helo control is reaching here.",currentAnswer);
    setAnswer(currentAnswer);
    setCanISend(true);
  }
  async function handleAnswer(data) {
    await pc.current.setRemoteDescription(data.answer);
    for (const candidate of iceCandidatesReceivedBuffer) {
      console.log('Adding ice candidates.');
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


