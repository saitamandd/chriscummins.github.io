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

  var programContainsRoutines = false;

  // An instruction
  var Instruction = function(instruction, address, comment) {

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

    if (comment !== undefined)
      this.comment = comment;

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
    case 6:
      this.mnemonic = 'bsr';
      this.instruction = this.mnemonic.toUpperCase() + '  ' + address;
      this.desc = 'Call subroutine ' + address;
      this.next = [jumpAddress];
      programContainsRoutines = true; // Shit!
      break;
    case 7:
      this.mnemonic = 'rsr';
      this.instruction = this.mnemonic.toUpperCase();
      this.desc = 'Return from subroutine';
      break;
    case 8:
      this.mnemonic = 'rir';
      this.instruction = this.mnemonic.toUpperCase();
      this.desc = 'Return from interrupt';
      break;
    case 9:
      this.mnemonic = 'sei';
      this.instruction = this.mnemonic.toUpperCase();
      this.desc = 'Enable interrupts';
      break;
    case 10:
      this.mnemonic = 'cli';
      this.instruction = this.mnemonic.toUpperCase();
      this.desc = 'Disable interrupts';
      break;
    default:
      throw "Invalid opcode '" + bytes[0] + "'";
    };

    this.getLabel = function(type) {
      if (this.label === undefined) {
        if (type == 'routine')
          this.label = new RoutineLabel();
        else if (type == 'interrupt')
          this.label = new HandlerLabel();
        else
          this.label = new Label();
      }

      return this.label;
    };

    this.toString = function(instructions) {
      var label = this.label ? this.getLabel().toString() + '\n' : '';
      var string = '        ';

      if (this.next[0] !== this.address + 1) {
        string += this.mnemonic + '  ';

        if (this.address < idtLength) // Interrupt handler
          string += instructions[this.next[0]].getLabel('interrupt').name;
        else if (this.mnemonic == 'bsr')
          string += instructions[this.next[0]].getLabel('routine').name;
        else // Jump instruction
          string += instructions[this.next[0]].getLabel().name;

      } else if (this.next[1] !== undefined) // Branch instruction
        string += this.mnemonic + '  ' + instructions[this.next[1]].getLabel().name;
      else
        string += this.mnemonic;

      if (this.comment) // Add inline comment at character 32
        string = pad(string, 30, ' ', true) + ' ; ' + this.comment;

      return label + string;
    };
  };

  var Section = function(name) {
    this.toString = function() {
      return 'SECTION .' + name;
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
  var _routineCounter = 0; // Used for automatic interrupt label naming
  var _handlerCounter = 0; // Used for automatic interrupt label naming

  var Label = function(name) {
    this.name = name ? name : 'label' + _labelCounter++;

    this.toString = function() {
      return this.name + ':';
    };
  };

  var RoutineLabel = function(name) {
    this.name = name ? name : 'subroutine' + _routineCounter++;

    this.toString = function() {
      return this.name + ':';
    };
  };

  var HandlerLabel = function(name) {
    this.name = name ? name : 'irq' + _handlerCounter++;

    this.toString = function() {
      return this.name + ':';
    };
  };

  var code = $('#code');
  var errors = $('#errors');
  var warnings = $('#warnings');
  var output = $('#output');
  var assembly = $('#assembly');

  var idtLength = 8; // Interrupt Descriptor Table length (in words)

  // Decode an array of strings, one instruction per string
  var decode = function(text) {

    var instructions = [], idt = [], address = 0, string = '', lineNo = 0;

    try { // Parse instructions
      for (lineNo = 0; lineNo < text.length; lineNo++) {
        string = text[lineNo].trim();

        if (string.length) {
          if (lineNo < idtLength) { // Interrupt descriptor
            idt.push(new Instruction(string, address++,
                                     'Interrupt handler ' + lineNo));
          } else { // Instruction
            instructions.push(new Instruction(string, address++));
          }
        }
      }
    } catch (err) { // Stop decoding on first error
      addError("<strong>At line " + i + ":</strong> " + err);
    }

    if (programContainsRoutines)
      addWarning("<strong>No code visualisation</strong> " +
                 "Sorry, the code visualiser can't handle programs which " +
                 "contain subroutines.");

    return {
      instructions: instructions,
      idt: idt
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
                new BlankLine(),
                new Section('data'),
                new BlankLine()];
    var string = '';

    if (idt.length) // Set interrupt table label
      idt[0].label = new Label('interrupt_vectors');

    idt.forEach(function(e) {
      prog.push(e);
    });

    prog.push(new BlankLine());
    prog.push(new Section('text'));
    prog.push(new BlankLine());

    if (instructions.length) // Set special "start" label
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
    var idt = data.idt;

    // Show disassembled table
    idt.forEach(function(e) {
      addInstruction(e);
    });

    instructions.forEach(function(e) {
      addInstruction(e);
    });

    // Show assembly code
    assembly.html(assemble(data));

    if (idt.length || instructions.length)
      $('#code-output').show();
    else
      $('#code-output').hide();

    // Draw flowchart
    if (_diagram)
      _diagram.clean();

    if (!programContainsRoutines) { // Only draw the flowchart if we can
      _diagram = flowchart.parse(instructionsToChart(instructions));
      _diagram.drawSVG('diagram');
    }
  };

  var addError = function(msg) {
    errors.append("<div class=\"alert alert-error\">" + msg +
                  "<a class=\"close\" data-dismiss=\"alert\" " +
                  "href=\"#\">&times;</a></div>");
  };

  var addWarning = function(msg) {
    warnings.append("<div class=\"alert alert-warning\">" + msg +
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
    warnings.html('');
    output.html('');
    assembly.html('');
    _labelCounter = 0;
    _routineCounter = 0;
    _handlerCounter = 0;

    show(decode(code.val().split("\n")));
  });
}).call(Disassembler);
