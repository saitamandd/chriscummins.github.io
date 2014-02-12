var Disassembler = Disassembler || {};

(function() {
  'use strict';

  // Pad the number 'n' to with padding character 'z' to width 'width'.
  function pad(n, width, z, tail) {
    z = z || '0';
    n = n + '';
    return n.length >= width ? n : tail ?
      n + new Array(width - n.length + 1).join(z) :
      new Array(width - n.length + 1).join(z) + n;
  }

  // An instruction
  var Instruction = function(instruction, address) {

    if (instruction.length != 8 || !instruction.match(/[0-9a-fA-F]{8}/)) {
      throw "Invalid instruction '" + instruction + "'";
    }

    var bytes = function(number) {
      var p = [];

      for (var i = Math.floor(number.length / 2); i-->0;)
        p[i] = number.slice(i * 2, (i + 1) * 2);

      return p;
    }(instruction);

    this.binary = instruction;
    this.address = address;
    this.next = [this.address + 1];

    var address = bytes[1] + bytes[2] + bytes[3];
    var jumpAddress = parseInt(address, 16) - 8;

    switch (parseInt(bytes[0], 16)) {
    case 0:
      this.mnemonic = 'iuc';
      this.instruction = this.mnemonic.toUpperCase();
      this.desc = 'No operation';
      break;
    case 1:
      this.mnemonic = 'huc';
      this.instruction = this.mnemonic.toUpperCase();
      this.desc = 'Terminate';
      break;
    case 2:
      this.mnemonic = 'buc';
      this.instruction = this.mnemonic.toUpperCase() + '  ' + address;
      this.desc = 'Jump to ' + address;
      this.next = [jumpAddress];
      break;
    case 3:
      this.mnemonic = 'bic';
      this.instruction = this.mnemonic.toUpperCase() + '  ' + address;
      this.desc = 'Jump to ' + address + ' if condition flag is set';
      this.next.push(jumpAddress);
      break;
    case 4:
      this.mnemonic = 'seto 0x' + bytes[1] + ', 0x' +
        bytes[2] + ', 0x' + bytes[3];
      this.instruction = 'SETO ' + bytes[1] + bytes[2] + bytes[3];
      this.desc = 'Set outputs ' + bytes[1] + ' AND ' + bytes[2] + ' XOR ' + bytes[3];
      break;
    case 5:
      this.mnemonic = 'tsti 0x' + bytes[1] + ', 0x' +
        bytes[2] + ', 0x' + bytes[3];
      this.instruction = 'TSTI ' + bytes[1] + bytes[2] + bytes[3];
      this.desc = 'Test input port ' + parseInt(bytes[1], 16) + ' AND ' +
        bytes[2] + ' XOR ' + bytes[3];
      break;
    default:
      throw "Invalid opcode '" + bytes[0] + "'";
    };

    this.getLabel = function() {
      if (this.label === undefined)
        this.label = new Label();

      return this.label;
    };

    this.toString = function(instructions) {
      var string = this.label ? this.getLabel().toString() + '\n' : '';

      string += '        ';

      if (this.next[0] !== this.address + 1) // Jump instruction
        string += this.mnemonic + '  ' + instructions[this.next[0]].getLabel().name;
      else if (this.next[1] !== undefined) // Branch instruction
        string += this.mnemonic + '  ' + instructions[this.next[1]].getLabel().name;
      else
        string += this.mnemonic;

      return string;
    };
  };

  var Comment = function(text) {
    this.toString = function() {
      return ';; ' + text;
    };
  };

  var BlankLine = function() {
    this.toString = function() {
      return '';
    };
  };

  var _labelCounter = 0; // Used for automatic label naming

  var Label = function(name) {
    this.name = name ? name : 'label' + _labelCounter++;

    this.toString = function() {
      return this.name + ':';
    };
  };

  var code = $('#code');
  var errors = $('#errors');
  var output = $('#output');
  var assembly = $('#assembly');

  // Decode an array of strings, one instruction per string
  var decode = function(text) {
    var instructions = [], address = 0, string = '';

    try { // Parse instructions
      for (var i = 0; i < text.length; i++) {
        string = text[i].trim()

        if (string.length)
          instructions.push(new Instruction(string, address++));
      }
    } catch (err) { // Stop decoding on first error
      addError("<strong>At line " + i + ":</strong> " + err);
    }

    return {
      instructions: instructions,
    };
  }

  var instructionsToChart = function(instructions) {
    var definitions = "st=>start: Start\ne=>end: End\n", links = "";

    var instructionDefinition = function(instruction, i) {
      if (instruction.next[1] !== undefined) // Conditional instruction
        return "i" + i + "=>condition: " + instruction.instruction + "\n";
      else // Unconditional instruction
        return "i" + i + "=>operation: " + instruction.instruction + "\n";
    };

    var instructionLinks = function(instruction, i) {
      if (instruction.next[1] !== undefined) { // Conditional instruction
        var links = "";

        if (instruction.next[0] !== -1) // Valid address
          links = "i" + i + "(no)->i" + instruction.next[0] + "\n";
        if (instruction.next[1] !== -1) // Valid address
          links += "i" + i + "(yes, right)->i" + instruction.next[1] + "\n";

        return links
      } else {
        if (instruction.next[0] !== -1) // Valid address
          return "i" + i + "->i" + instruction.next[0] + "\n";
        else
          return "";
      }
    }

    if (instructions.length) // Start and end symbols
      links += "st->i0\ni" + (instructions.length - 1) + "->e\n";

    for (var i = 0; i < instructions.length; i++) {
      // Check for valid addresses
      if (instructions[i].next[0] >= instructions.length)
        instructions[i].next[0] = -1;

      if (instructions[i].next[1] >= instructions.length)
        instructions[i].next[1] = -1;

      definitions += instructionDefinition(instructions[i], i);
      links += instructionLinks(instructions[i], i);
    }

    return definitions + links;
  }

  var assemble = function(data) {
    var instructions = data.instructions;
    var idt = data.idt;
    var prog = [new Comment('Generated assembly, see:'),
                new Comment('    http://chriscummins.cc/disassembler'),
                new Comment(''),
                new BlankLine()], string = '';

    if (instructions.length)
      instructions[0].label = new Label('start');

    instructions.forEach(function(e) {
      prog.push(e);
    });

    // Generate label cross references
    prog.forEach(function(e) {
      e.toString(instructions);
    });

    prog.push(new BlankLine());
    prog.push(new Comment('End of program code'))

    // Generate textual representation
    prog.forEach(function(e) {
      string += e.toString(instructions) + '\n';
    });

    return string;
  };

  var _diagram; // The flowchart

  // Display an array of instructions
  var show = function(data) {

    var instructions = data.instructions;
    // Show disassembled table
    instructions.forEach(function(e) {
      addInstruction(e);
    });

    // Show assembly code
    assembly.html(assemble(data));

    if (instructions.length)
      $('#code-output').show();
    else
      $('#code-output').hide();

    // Draw flowchart
    if (_diagram)
      _diagram.clean();

    _diagram = flowchart.parse(instructionsToChart(instructions));
    _diagram.drawSVG('diagram');
  };

  var addError = function(msg) {
    errors.append("<div class=\"alert alert-error\">" + msg +
                  "<a class=\"close\" data-dismiss=\"alert\" " +
                  "href=\"#\">&times;</a></div>");
  };

  var addInstruction = function(instruction) {
    output.append("<tr><td class=\"address\">" +
                  pad(instruction.address.toString(16), 8).toUpperCase() +
                  "</td><td class=\"opcode\">" + instruction.binary + "</td>" +
                  "<td class=\"instruction\">" + instruction.instruction + "</td>" +
                  "<td class=\"description\">" + instruction.desc + "</td>" +
                  "</tr>");
  };

  // Update as the user types
  code.bind('input propertychange', function() {
    errors.html('');
    output.html('');
    assembly.html('');
    _labelCounter = 0;

    show(decode(code.val().split("\n")));
  });
}).call(Disassembler);