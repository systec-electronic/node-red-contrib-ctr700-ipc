
## About

The 'node-red-contrib-ctr700-ipc' is a Node-RED node collection for
the sysWORXX CTR-700 Edge Controller from SYS TEC electronic GmbH
(see https://www.systec-electronic.com/en/products/internet-of-things/sysworxx-ctr-700)

This node collection supports the data exchange between OpenPCS
(IEC-61131-3 PLC Runtime System running on the sysWORXX CTR-700)
and Node-RED. With the help of these nodes it is possible to use
Node-RED as a graphical interface for OpenPCS PLC programs.


## License

Apache License, Version 2.0
(see http://www.apache.org/licenses/LICENSE-2.0)


## Install

Run the following command in your node-RED user directory (typically `~/.node-red`):

    npm install node-red-contrib-ctr700-ipc


## Content

openpcs_read:   node to read data from OpenPCS (OpenPCS -> Node-RED)
openpcs_write:  node to write data to OpenPCS (Node-RED -> OpenPCS)


## Node status

The state of the nodes is indicated by a status object (dot, grey/green/red) and text
(depending on IPC status)


