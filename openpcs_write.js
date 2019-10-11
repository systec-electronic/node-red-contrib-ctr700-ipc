/****************************************************************************

  (c) SYSTEC electronic AG, D-08468 Heinsdorfergrund, Am Windrad 2
      www.systec-electronic.com

  Project:      Node-RED Node 'openpcs write'
  Description:  Node implementation

  -------------------------------------------------------------------------

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

  -------------------------------------------------------------------------

  Revision History:

  2018/04/02 -rs:   V1.00 Initial version
  2019/03/20 -ad:   V1.01 Fix handling for initial value

****************************************************************************/


module.exports = function(RED)
{

    //*********************************************************************//
    //                                                                     //
    //                  G L O B A L S                                      //
    //                                                                     //
    //*********************************************************************//

    "use strict";


    //=======================================================================
    //  Import external modules
    //=======================================================================

    const Ipc = require('./ipcclient.js');



    //=======================================================================
    //  Runtime Configuration
    //=======================================================================

    // Disable runtime warning: "Possible EventEmitter memory leak detected. 11 nodes-started listeners added. Use  emitter.setMaxListeners() to increase limit"
    require('events').EventEmitter.defaultMaxListeners = 0;

    const IPC_POLL_TIME              = 100;         // IPC polling time in [ms]
    const IPC_GET_VAR_TYPE_TIMEOUT   = 1000;        // IPC time out for quering variable class type in [ms]

    const TRACE_ENABLE_ALL           = false;       // Enables traces for all nodes
    const TRACE_ENABLE_NODE_NAME_DBG = true;        // Enables traces only for nodes which node names starts with 'DBG_'



    //=======================================================================
    //  Constant definitions
    //=======================================================================

    const IPC_STATE_ACTIVE   =  1;
    const IPC_STATE_IDLE     =  0;
    const IPC_STATE_PLC_STOP = -1;
    const IPC_STATE_ERROR    = -2;
    const IPC_STATE_UNDEF    = -3;

    const SHSTATE_NONE       =  0;
    const SHSTATE_IND        =  1;
    const SHSTATE_IND_TSTAMP =  2;



    //=======================================================================
    //  Register node to Node-RED nodes palette
    //=======================================================================

    RED.nodes.registerType ("openpcs write", OpenPCS_Write_Node);



    //=======================================================================
    //  Node implementation
    //=======================================================================

    function  OpenPCS_Write_Node (NodeConfig_p)
    {

        //-------------------------------------------------------------------
        //  Node main function
        //-------------------------------------------------------------------

        let ThisNode = this;

        // create new node instance
        RED.nodes.createNode (this, NodeConfig_p);

        // register handler for event type 'input'
        ThisNode.on ('input', OpenPCS_Write_NodeHandler_OnInput);

        // register handler for event type 'close'
        ThisNode.on ('close', OpenPCS_Write_NodeHandler_OnClose);

        // register one-time handler for sending the initial value
        ThisNode.m_injectImmediate = setImmediate(function()
        {
            OpenPCS_Write_NodeHandler_OnNodesStarted();
        });

        // run handler for event type 'open'
        OpenPCS_Write_NodeHandler_OnOpen (NodeConfig_p);

        return;



        //-------------------------------------------------------------------
        //  Node event handler [NODE / OPEN]
        //-------------------------------------------------------------------

        function  OpenPCS_Write_NodeHandler_OnOpen (NodeConfig_p)
        {

            var strName;
            var strVarPath;
            var strVarType;
            var fAltTopic;
            var strAltTopic;
            var strIpcStatIndLvl;
            var strNewDataPeriod;

            ThisNode.m_NodeConfig = NodeConfig_p;
            TraceMsg ('{OpenPCS_Write_Node} creating...');

            // create and initialize members
            ThisNode.m_strVarPath = '';
            ThisNode.m_strVarType = '';
            ThisNode.m_ObjVarInst = null;
            ThisNode.m_strTopic = '';
            ThisNode.m_iIpcStatIndLvl = 0;
            ThisNode.m_iNewDataPeriod = 0;
            ThisNode.m_ObjIpcClient = null;
            ThisNode.m_EventSubscript = null;
            ThisNode.m_VarSubscript = null;
            ThisNode.m_LastVarValue = null;
            ThisNode.m_fPlcStopped = false;
            ThisNode.m_iLastIpcState = IPC_STATE_UNDEF;
            ThisNode.m_ObjStatusTimer = null;
            ThisNode.m_iStatusTimerInst = 0;


            // get node configuration
            strVarPath       = ThisNode.m_NodeConfig.varpath;
            strVarType       = ThisNode.m_NodeConfig.vartype;
            fAltTopic        = ThisNode.m_NodeConfig.optalttopic;
            strAltTopic      = ThisNode.m_NodeConfig.alttopic;
            strIpcStatIndLvl = ThisNode.m_NodeConfig.ipcstatindlvl;
            strNewDataPeriod = ThisNode.m_NodeConfig.newdataperiod;
            strName          = ThisNode.m_NodeConfig.name;

            TraceMsg ('{OpenPCS_Write_Node} strVarPath:       ' + strVarPath);
            TraceMsg ('{OpenPCS_Write_Node} strVarType:       ' + strVarType);
            TraceMsg ('{OpenPCS_Write_Node} fAltTopic:        ' + fAltTopic);
            TraceMsg ('{OpenPCS_Write_Node} strAltTopic:      ' + strAltTopic);
            TraceMsg ('{OpenPCS_Write_Node} strIpcStatIndLvl: ' + strIpcStatIndLvl);
            TraceMsg ('{OpenPCS_Write_Node} strNewDataPeriod: ' + strNewDataPeriod);
            TraceMsg ('{OpenPCS_Write_Node} strName:          ' + strName);

            // get full qualified variable path as well as variable type
            ThisNode.m_strVarPath = strVarPath;
            ThisNode.m_strVarType = strVarType;

            // get topic for variable value messages to accept and process
            ThisNode.m_strTopic = OpenPCS_Write_BuildTopicString (ThisNode.m_strVarPath, fAltTopic, strAltTopic);
            TraceMsg ('{OpenPCS_Write_Node} m_strTopic: ' + ThisNode.m_strTopic);

            // get IPC status indication level
            ThisNode.m_iIpcStatIndLvl = OpenPCS_Write_GetIpcStatusIndicationLevel (strIpcStatIndLvl);
            TraceMsg ('{OpenPCS_Write_Node} m_iIpcStatIndLvl: ' + ThisNode.m_iIpcStatIndLvl);

            // get timer period for IPC "new data" indication
            ThisNode.m_iNewDataPeriod = OpenPCS_Write_GetIpcNewDataIndicationPeriod (strNewDataPeriod);
            TraceMsg ('{OpenPCS_Write_Node} m_iNewDataPeriod: ' + ThisNode.m_iNewDataPeriod);

            // cleares the status entry initially from the node
            OpenPCS_Write_ShowIpcState (IPC_STATE_UNDEF);


            // create IPC object instance
            TraceMsg ('{OpenPCS_Write_Node} new Ipc.IpcClientSingleton');
            ThisNode.m_ObjIpcClient = new Ipc.IpcClientSingleton ('/var/run/Ipc0Request', '/var/run/Ipc0Response', IPC_POLL_TIME);

            // register callback handler for status event notification
            TraceMsg ('{OpenPCS_Write_Node} ObjIpcClient.subscribeEvents()');
            try
            {
                ThisNode.m_EventSubscript = ThisNode.m_ObjIpcClient.subscribeEvents (OpenPCS_Write_CbHandlerStatusEvent);
            }
            catch (ErrInfo)
            {
                TraceMsg ('{OpenPCS_Write_Node} ERROR: ' + ErrInfo.message);

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, ErrInfo.message);
            }


            // create variable runtime instance
            ThisNode.m_ObjVarInst = OpenPCS_Write_GetVariableObject (ThisNode.m_strVarPath, ThisNode.m_strVarType);
            if (ThisNode.m_ObjVarInst == null)
            {
                TraceMsg ('{OpenPCS_Write_Node} ERROR: ThisNode.m_ObjVarInst == null');

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR);
                return;
            }

            // register variable runtime instance to IPC object instance
            TraceMsg ('{OpenPCS_Write_Node} ObjIpcClient.register (' + ThisNode.m_strVarPath + ')');
            try
            {
                ThisNode.m_ObjIpcClient.register (ThisNode.m_ObjVarInst);
            }
            catch (ErrInfo)
            {
                TraceMsg ('{OpenPCS_Write_Node} ERROR: ' + ErrInfo.message);

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, ErrInfo.message);
            }

            // register callback handler for variable type check notification
            TraceMsg ('{OpenPCS_Write_Node} ObjVarInst.subscribeTypeMatch (' + ThisNode.m_strVarPath + ')');
            try
            {
                ThisNode.m_ObjVarInst.subscribeTypeMatch (OpenPCS_Write_CbHandlerTypeMatch);
            }
            catch (ErrInfo)
            {
                TraceMsg ('{OpenPCS_Write_Node} ERROR: ' + ErrInfo.message);

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, ErrInfo.message);
            }

            // register callback handlers for variable value change notification and error notification
            TraceMsg ('{OpenPCS_Write_Node} ObjVarInst.subscribe (' + ThisNode.m_strVarPath + ')');
            try
            {
                ThisNode.m_VarSubscript = ThisNode.m_ObjVarInst.subscribe (OpenPCS_Write_CbHandlerVarValueChanged, OpenPCS_Write_CbHandlerVarError);
            }
            catch (ErrInfo)
            {
                TraceMsg ('{OpenPCS_Write_Node} ERROR: ' + ErrInfo.message);

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, ErrInfo.message);
            }


            // publishing initial input channel state is done in callback function 'OpenPCS_Write_CbHandlerTypeMatch()'

            return;

        }



        //-------------------------------------------------------------------
        //  Node event handler [NODE / CLOSE]
        //-------------------------------------------------------------------

        function  OpenPCS_Write_NodeHandler_OnClose ()
        {

            TraceMsg ('{OpenPCS_Write_Node} closing...');

            // clear immediate timeout
            if (ThisNode.m_injectImmediate)
            {
                clearImmediate(ThisNode.m_injectImmediate);
            }

            // cancel possibly running status timer
            if ( ThisNode.m_ObjStatusTimer )
            {
                clearTimeout (ThisNode.m_ObjStatusTimer);
                ThisNode.m_ObjStatusTimer = null;
            }

            // delete variable runtime instance
            ThisNode.m_ObjIpcClient.close();
            ThisNode.m_ObjIpcClient = null;

            // cleares the status entry from the node
            OpenPCS_Write_ShowIpcState (IPC_STATE_UNDEF);

            return;

        };



        //-------------------------------------------------------------------
        //  Node event handler [NODE / EVENT_INPUT]
        //-------------------------------------------------------------------

        function  OpenPCS_Write_NodeHandler_OnInput (Msg_p)
        {

            var fTopicMatch;
            var strVarValue;

            TraceMsg ('{OpenPCS_Write_Node} procesing input message...');
            TraceMsg ('{OpenPCS_Write_Node} Msg_p.topic: ' + Msg_p.topic);
            TraceMsg ('{OpenPCS_Write_Node} Msg_p.payload: ' + Msg_p.payload);

            // check if received message matches to configured topic
            fTopicMatch = OpenPCS_Write_IsTopicMatch (ThisNode.m_strTopic, Msg_p.topic);
            TraceMsg ('{OpenPCS_Write_Node} TopicMatch(' + ThisNode.m_strTopic + ', ' + Msg_p.topic + ') -> ' + fTopicMatch.toString());
            if ( !fTopicMatch )
            {
                // received message doesn't matches to configured topic -> abort processing
                TraceMsg ('{OpenPCS_Write_Node} Topic Mismatch -> Ignore Message');
                return;
            }

            // check if message paylod is valid
            if (Msg_p.payload == null)
            {
                // payload of received message is NULL -> abort processing
                TraceMsg ('{OpenPCS_Write_Node} payload==null -> Ignore Message');
                return;
            }

            // save variable value to write
            ThisNode.m_LastVarValue = Msg_p.payload;

            // write variable value
            if (ThisNode.m_ObjVarInst != null)
            {
                OpenPCS_Write_IpcWriteVarValue (ThisNode.m_ObjVarInst, ThisNode.m_LastVarValue, ThisNode.m_strVarType);
            }
            else
            {
                TraceMsg ('{OpenPCS_Write_NodeHandler_OnInput} ERROR: ThisNode.m_ObjVarInst == null');

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR);
            }

            return;

        };



        //-------------------------------------------------------------------
        //  Node event handler [EVENTS / NODE_STARTED]
        //-------------------------------------------------------------------

        function  OpenPCS_Write_NodeHandler_OnNodesStarted ()
        {

            TraceMsg ('{OpenPCS_Write_Node} process initial input state...');

            // show IPC state in editor
            if (ThisNode.m_ObjVarInst != null)
            {
                OpenPCS_Write_ShowIpcState (IPC_STATE_IDLE);
            }
            else
            {
                TraceMsg ('{OpenPCS_Write_NodeHandler_OnNodesStarted} ERROR: ObjVarInst_p == null');
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR);
            }

            return;

        }



        //-------------------------------------------------------------------
        //  Private: Callback handler for processing status events
        //-------------------------------------------------------------------

        function  OpenPCS_Write_CbHandlerStatusEvent (strEvent_p)
        {

            TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_CbHandlerStatusEvent: strEvent_p=' + strEvent_p);

            switch (strEvent_p)
            {
                case 'START':
                {
                    TraceMsg (' ');
                    TraceMsg (' ');
                    TraceMsg ('{OpenPCS_Write_Node} PLC state switched to RUN');
                    TraceMsg (' ');
                    TraceMsg (' ');

                    // cleares the status entry initially from the node
                    ThisNode.m_fPlcStopped = false;

                    // show IPC state in editor
                    if (ThisNode.m_ObjVarInst != null)
                    {
                        OpenPCS_Write_ShowIpcState (IPC_STATE_IDLE);
                    }
                    else
                    {
                        TraceMsg ('{OpenPCS_Write_CbHandlerStatusEvent} ERROR: ObjVarInst_p == null');
                        OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR);
                    }

                    // repeat writing of last received variable value via IPC
                    if ((ThisNode.m_ObjVarInst != null) && (ThisNode.m_LastVarValue != null))
                    {
                        OpenPCS_Write_IpcWriteVarValue (ThisNode.m_ObjVarInst, ThisNode.m_LastVarValue, ThisNode.m_strVarType);
                    }
                    break;
                }

                case 'STOP':
                {
                    TraceMsg (' ');
                    TraceMsg (' ');
                    TraceMsg ('{OpenPCS_Write_Node} PLC state switched to STOP');
                    TraceMsg (' ');
                    TraceMsg (' ');

                    // cleares the status entry initially from the node
                    OpenPCS_Write_ShowIpcState (IPC_STATE_PLC_STOP);
                    ThisNode.m_fPlcStopped = true;
                    break;
                }

                default:
                {
                    TraceMsg ('{OpenPCS_Write_Node} ERROR: OpenPCS_Write_CbHandlerStatusEvent() - unknown event type');
                    break;
                }
            }

            return;

        }



        //-------------------------------------------------------------------
        //  Private: Callback handler for variable type check match
        //-------------------------------------------------------------------

        function  OpenPCS_Write_CbHandlerTypeMatch (ObjVarInst_p, fSuccess_p, Error_p)
        {

            TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_CbHandlerTypeMatch: ObjVarInst_p.name()=' + ObjVarInst_p.name());

            TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_CbHandlerTypeMatch: fSuccess_p=' + fSuccess_p);
            if (fSuccess_p == true)
            {
                // write last received variable value via IPC
                if ((ThisNode.m_ObjVarInst != null) && (ThisNode.m_LastVarValue != null))
                {
                    OpenPCS_Write_IpcWriteVarValue (ThisNode.m_ObjVarInst, ThisNode.m_LastVarValue, ThisNode.m_strVarType);
                }
            }
            else
            {
                TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_CbHandlerTypeMatch: Error_p.message=' + Error_p.message + ', Error_p.code=' + Error_p.code);

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, Error_p.message);
            }

            return;

        }



        //-------------------------------------------------------------------
        //  Private: Callback handler for variable value changes
        //-------------------------------------------------------------------

        function  OpenPCS_Write_CbHandlerVarValueChanged (ObjVarInst_p, VarValue_p)
        {

            TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_CbHandlerVarValueChanged: ObjVarInst_p.name()=' + ObjVarInst_p.name() + ', VarValue_p=' + VarValue_p);

            // there is nothing else to do here...

            return;

        }



        //-------------------------------------------------------------------
        //  Private: Callback handler for variable error
        //-------------------------------------------------------------------

        function  OpenPCS_Write_CbHandlerVarError (ObjVarInst_p, Error_p)
        {

            TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_CbHandlerVarError: ObjVarInst_p.name()=' + ObjVarInst_p.name() + ', Error_p.message=' + Error_p.message + ', Error_p.code=' + Error_p.code);

            // show IPC state in editor
            OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, Error_p.message);

            return;

        }



        //-------------------------------------------------------------------
        //  Private: Get variable object instance
        //-------------------------------------------------------------------

        function  OpenPCS_Write_GetVariableObject (strVarPath_p, strVarType_p)
        {

            var VarTypeClass;
            var ObjVarInst;

            TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: strVarPath_p=' + strVarPath_p + ', strVarType_p=' + strVarType_p);

            switch (strVarType_p)
            {
                case 'VARTYPE_AUTO':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarAuto');
                    try
                    {
                        VarTypeClass = ThisNode.m_ObjIpcClient.getVariableClassSync (strVarPath_p, IPC_GET_VAR_TYPE_TIMEOUT);
                        ObjVarInst = new VarTypeClass (strVarPath_p);
                    }
                    catch (ErrInfo)
                    {
                        TraceMsg ('{OpenPCS_Write_Node} ERROR: ' + ErrInfo.message);
                        ObjVarInst = null;

                        // show IPC state in editor
                        OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, ErrInfo.message);
                    }
                    break;
                }

                case 'VARTYPE_STRING':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarString');
                    ObjVarInst = new Ipc.IpcVarString (strVarPath_p);
                    break;
                }

                case 'VARTYPE_BOOL':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarBool');
                    ObjVarInst = new Ipc.IpcVarBool (strVarPath_p);
                    break;
                }

                case 'VARTYPE_BYTE':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarByte');
                    ObjVarInst = new Ipc.IpcVarByte (strVarPath_p);
                    break;
                }

                case 'VARTYPE_USINT':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarUSInt');
                    ObjVarInst = new Ipc.IpcVarUSInt (strVarPath_p);
                    break;
                }

                case 'VARTYPE_SINT':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarSInt');
                    ObjVarInst = new Ipc.IpcVarSInt (strVarPath_p);
                    break;
                }

                case 'VARTYPE_WORD':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarWord');
                    ObjVarInst = new Ipc.IpcVarWord (strVarPath_p);
                    break;
                }

                case 'VARTYPE_UINT':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarUInt');
                    ObjVarInst = new Ipc.IpcVarUInt (strVarPath_p);
                    break;
                }

                case 'VARTYPE_INT':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarInt');
                    ObjVarInst = new Ipc.IpcVarInt (strVarPath_p);
                    break;
                }

                case 'VARTYPE_DWORD':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarDWord');
                    ObjVarInst = new Ipc.IpcVarDWord (strVarPath_p);
                    break;
                }

                case 'VARTYPE_UDINT':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarUDInt');
                    ObjVarInst = new Ipc.IpcVarUDInt (strVarPath_p);
                    break;
                }

                case 'VARTYPE_DINT':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarDInt');
                    ObjVarInst = new Ipc.IpcVarDInt (strVarPath_p);
                    break;
                }

                case 'VARTYPE_REAL':
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ObjVarInst=IpcVarReal');
                    ObjVarInst = new Ipc.IpcVarReal (strVarPath_p);
                    break;
                }

                default:
                {
                    TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_GetVariableObject: ERROR: unknown/unsupported Type (ObjVarInst=null)');
                    ObjVarInst = null;
                    break;
                }
            }

            return (ObjVarInst);

        }



        //-------------------------------------------------------------------
        //  Private: Write variable value via IPC
        //-------------------------------------------------------------------

        function  OpenPCS_Write_IpcWriteVarValue (ObjVarInst_p, VarValue_p, strVarType_p)
        {

            var strVarValue;

            TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_IpcWriteVarValue: ObjVarInst_p.name()=' + ObjVarInst_p.name());

            // check if variable runtime object is valid
            if (ObjVarInst_p == null)
            {
                TraceMsg ('{OpenPCS_Write_IpcWriteVarValue} ERROR: ObjVarInst_p == null');

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR);
                return;
            }


            // convert variable type if necessary
            if (strVarType_p != null)
            {
                switch (strVarType_p)
                {
                    case 'VARTYPE_STRING':
                    {
                        TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_IpcWriteVarValue: convert to type STRING');
                        try
                        {
                            VarValue_p = VarValue_p.toString();
                        }
                        catch (ErrInfo)
                        {
                            TraceMsg ('{OpenPCS_Write_Node} ERROR: ' + ErrInfo.message);

                            // show IPC state in editor
                            OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, 'Failed to convert value to sring');
                        }
                        break;
                    }

                    case 'VARTYPE_BOOL':
                    {
                        TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_IpcWriteVarValue: convert to type BOOL');
                        try
                        {
                            if (typeof(VarValue_p) === 'string')
                            {
                                VarValue_p = VarValue_p.trim().toLowerCase();
                            }
                            switch (VarValue_p)
                            {
                                case true:
                                case "true":
                                case 1:
                                case "1":
                                case "on":
                                case "yes":
                                {
                                    VarValue_p = true;
                                    break;
                                }
                                default:
                                {
                                    VarValue_p = false;
                                    break;
                                }
                            }
                        }
                        catch (ErrInfo)
                        {
                            TraceMsg ('{OpenPCS_Write_Node} ERROR: ' + ErrInfo.message);

                            // show IPC state in editor
                            OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, 'Failed to convert value to boolean');
                        }
                        break;
                    }

                    default:
                    {
                        break;
                    }
                }
            }

            // set variable value via IPC
            try
            {
                // write variable value via IPC
                ObjVarInst_p.set (VarValue_p);

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ACTIVE);
            }
            catch (ErrInfo)
            {
                TraceMsg ('{OpenPCS_Write_Node} ERROR: ' + ErrInfo.message);

                // show IPC state in editor
                OpenPCS_Write_ShowIpcState (IPC_STATE_ERROR, ErrInfo.message);
            }

            return;

        }



        //-------------------------------------------------------------------
        //  Private: Build topic string for messages to accept and process
        //-------------------------------------------------------------------

        function  OpenPCS_Write_BuildTopicString (strVarPath_p, fAltTopic_p, strAltTopic_p)
        {

            var strTopic;

            // select between default and alternative topic
            if ( !fAltTopic_p )
            {
                strTopic = strVarPath_p;
            }
            else
            {
                strTopic = strAltTopic_p;
            }

            // normalize topic
            strTopic = strTopic.trim();

            return (strTopic);

        }



        //-------------------------------------------------------------------
        //  Private: Check if mesage topic matches to configured topic
        //-------------------------------------------------------------------

        function  OpenPCS_Write_IsTopicMatch (strCfgNodeTopic_p, strRecvMsgTopic_p)
        {

            var strRecvMsgTopic;
            var strCfgNodeTopic;

            // normalize topic strings
            strRecvMsgTopic = strRecvMsgTopic_p.trim();
            strRecvMsgTopic = strRecvMsgTopic.toLowerCase();
            strCfgNodeTopic = strCfgNodeTopic_p.toLowerCase();

            // check for wildcard topic
            if (strCfgNodeTopic_p == '#')
            {
                return (true);
            }

            // check if mesage topic matches to configured topic
            if (strRecvMsgTopic_p == strCfgNodeTopic_p)
            {
                return (true);
            }

            return (false);

        }



        //-------------------------------------------------------------------
        //  Private: Callback handler for status timer
        //-------------------------------------------------------------------

        function  OpenPCS_Write_CbHandlerStatusTimer (iStatusTimerInst_p)
        {

            TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_CbHandlerStatusTimer (' + iStatusTimerInst_p + ')');

            clearTimeout (ThisNode.m_ObjStatusTimer);
            ThisNode.m_ObjStatusTimer = null;
            OpenPCS_Write_ShowIpcState (IPC_STATE_IDLE);

            return;

        }



        //-------------------------------------------------------------------
        //  Private: Show IPC state in editor
        //-------------------------------------------------------------------

        function  OpenPCS_Write_ShowIpcState (iIpcState_p, strErrorInfo_p)
        {

            var fStateChanged;
            var TimeStamp;
            var Hour;
            var Min;
            var Sec;
            var strTimeStamp;
            var strStatDescript;
            var strStatMsg;

            TraceMsg ('{OpenPCS_Write_Node} OpenPCS_Write_ShowIpcState: iIpcState_p=' + iIpcState_p + ', m_iIpcStatIndLvl=' + ThisNode.m_iIpcStatIndLvl);

            // check if state was changed since last call
            fStateChanged = (iIpcState_p == ThisNode.m_iLastIpcState) ? false : true;
            ThisNode.m_iLastIpcState = iIpcState_p;

            // remove status label from node?
            if (iIpcState_p == IPC_STATE_UNDEF)
            {
                // an empty status object cleares the status entry from the node
                ThisNode.status ({});
                return;
            }

            // check if state indication is allowed at all
            if (ThisNode.m_iIpcStatIndLvl < SHSTATE_IND)
            {
                // state indication is disabled
                return;
            }

            // suppress state indicator redraw as long as the PLC is in stop mode
            if ( ThisNode.m_fPlcStopped )
            {
                return;
            }

            // build timestamp (depending on configured indication level)
            if (ThisNode.m_iIpcStatIndLvl == SHSTATE_IND_TSTAMP)
            {
                TimeStamp = new Date();
                Hour = TimeStamp.getHours();
                Min  = TimeStamp.getMinutes();
                Sec  = TimeStamp.getSeconds();

                // format numeric values to 2-digit-strings (with leading '0' for values < 10)
                Hour = (Hour < 10 ? '0' : '') + Hour;
                Min  = (Min  < 10 ? '0' : '') + Min;
                Sec  = (Sec  < 10 ? '0' : '') + Sec;
                strTimeStamp = Hour + ':' + Min + ':' + Sec;
            }

            // show IPC state in editor
            switch (iIpcState_p)
            {
                // -------------------- Active (-> green) ---------------------
                case IPC_STATE_ACTIVE:
                {
                    strStatMsg = 'Active';
                    if (ThisNode.m_iIpcStatIndLvl == SHSTATE_IND_TSTAMP)
                    {
                        strStatMsg = strTimeStamp + ' - ' + strStatMsg;
                    }
                    ThisNode.status ({fill:'green', shape:'dot', text:strStatMsg});

                    // start timer to clear 'active' status after configured interval
                    if ( ThisNode.m_ObjStatusTimer )
                    {
                        // cancel already running timer from previous call
                        TraceMsg ('{OpenPCS_Write_Node} clearTimeout()');
                        clearTimeout (ThisNode.m_ObjStatusTimer);
                    }
                    TraceMsg ('{OpenPCS_Write_Node} setTimeout (' + ThisNode.m_iNewDataPeriod + ', ' + ThisNode.m_iStatusTimerInst + ')');
                    ThisNode.m_ObjStatusTimer = setTimeout (OpenPCS_Write_CbHandlerStatusTimer, ThisNode.m_iNewDataPeriod, ThisNode.m_iStatusTimerInst);
                    ThisNode.m_iStatusTimerInst++;
                    break;
                }

                // -------------------- PLC Stop (-> red/ring) ----------------
                case IPC_STATE_PLC_STOP:
                {
                    strStatMsg = 'PLC STOPPED!';
                    if (ThisNode.m_iIpcStatIndLvl == SHSTATE_IND_TSTAMP)
                    {
                        strStatMsg = strTimeStamp + ' - ' + strStatMsg;
                    }
                    ThisNode.status ({fill:'red', shape:'ring', text:strStatMsg});
                    break;
                }

                // -------------------- Error (-> red) ------------------------
                case IPC_STATE_ERROR:
                {
                    // keep timestamp of first error occurrence
                    if ( !fStateChanged )
                    {
                        return;
                    }

                    strStatMsg = 'IPC Error';
                    if (strErrorInfo_p != undefined)
                    {
                        strStatMsg += ': ' + strErrorInfo_p;
                    }
                    if (ThisNode.m_iIpcStatIndLvl == SHSTATE_IND_TSTAMP)
                    {
                        strStatMsg = strTimeStamp + ' - ' + strStatMsg;
                    }
                    ThisNode.status ({fill:'red', shape:'dot', text:strStatMsg});
                    break;
                }

                // -------------------- Idle (-> grey) ------------------------
                case IPC_STATE_IDLE:
                default:
                {
                    // keep timestamp of first idle occurrence
                    if ( !fStateChanged )
                    {
                        return;
                    }

                    strStatMsg = 'Idle';
                    if (ThisNode.m_iIpcStatIndLvl == SHSTATE_IND_TSTAMP)
                    {
                        strStatMsg = strTimeStamp + ' - ' + strStatMsg;
                    }
                    ThisNode.status ({fill:'grey', shape:'dot', text:strStatMsg});
                    break;
                }
            }

            return;

        }



        //-------------------------------------------------------------------
        //  Private: Get IPC status indication level
        //-------------------------------------------------------------------

        function  OpenPCS_Write_GetIpcStatusIndicationLevel (strIpcStatIndLvl_p)
        {

            var iIpcStatIndLvl;

            // get IPC status indication level
            switch (strIpcStatIndLvl_p)
            {
                case 'SHSTATE_IND':
                {
                    iIpcStatIndLvl = SHSTATE_IND;
                    break;
                }

                case 'SHSTATE_IND_TSTAMP':
                {
                    iIpcStatIndLvl = SHSTATE_IND_TSTAMP;
                    break;
                }

                case 'SHSTATE_NONE':
                default:
                {
                    iIpcStatIndLvl = SHSTATE_NONE;
                    break;
                }
            }

            return (iIpcStatIndLvl);

        }



        //-------------------------------------------------------------------
        //  Private: Get timer period for IPC "new data" indication
        //-------------------------------------------------------------------

        function  OpenPCS_Write_GetIpcNewDataIndicationPeriod (strNewDataPeriod_p)
        {

            var iNewDataPeriod;

            // get timer period for IPC "new data" indication
            iNewDataPeriod = parseInt (strNewDataPeriod_p, 10);
            if (iNewDataPeriod == NaN)
            {
                iNewDataPeriod = 1;
            }

            // convert [sec] to [ms]
            iNewDataPeriod *= 1000;

            return (iNewDataPeriod);

        }



        //-------------------------------------------------------------------
        //  Private: Trace logging message
        //-------------------------------------------------------------------

        function  TraceMsg (strTraceMsg_p, strNodeName_p)
        {

            var fEnable = false;
            var strNodeName;

            // check if any enable option is set
            if ( TRACE_ENABLE_ALL )
            {
                // enable all -> no additional checks necessary
                fEnable = true;
            }
            else if ( TRACE_ENABLE_NODE_NAME_DBG )
            {
                // check if node name is given as runtime parameter to this function
                strNodeName = '';
                if (strNodeName_p !== undefined)
                {
                    // reuse node name given as parameter
                    strNodeName = strNodeName_p;
                }
                else
                {
                    // try to get node name from node configuration
                    // -> evaluate first if 'ThisNode.m_NodeConfig.name' is valid
                    if (ThisNode.m_NodeConfig !== undefined)
                    {
                        if (ThisNode.m_NodeConfig != null)
                        {
                            if ( ThisNode.m_NodeConfig.hasOwnProperty('name') )
                            {
                                if (ThisNode.m_NodeConfig.name != undefined)
                                {
                                    if (ThisNode.m_NodeConfig.name != null)
                                    {
                                        strNodeName = ThisNode.m_NodeConfig.name;
                                    }
                                }
                            }
                        }
                    }
                }

                if (strNodeName.substr(0,4) == 'DBG_')
                {
                    fEnable = true;
                }
            }

            if ( fEnable )
            {
                ThisNode.log (strTraceMsg_p);
            }

            return;

        }


    }   // function  OpenPCS_Write_Node (NodeConfig_p)


}   // module.exports = function(RED)




